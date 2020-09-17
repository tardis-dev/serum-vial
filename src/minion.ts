import { App, SHARED_COMPRESSOR, TemplatedApp, WebSocket } from 'uWebSockets.js'
import { isMainThread, parentPort, threadId, workerData } from 'worker_threads'
import { CHANNELS, MARKETS_SYMBOLS, MESSAGE_TYPES_PER_CHANNEL, OPS, PUB_TOPIC_NAME_FOR_MARKET } from './consts'
import { createDebugLogger } from './debug'
import { getAllowedValuesText, getDidYouMean } from './helpers'
import { listMarkets } from './markets'
import { DataMessage, ErrorResponse, SubRequest, SuccessResponse } from './types'

const debug = createDebugLogger(`minion:${threadId}`)

if (isMainThread) {
  const message = 'existing, minion is not meant to run in main thread'
  debug(message)

  throw new Error(message)
}

process.on('unhandledRejection', (err) => {
  throw err
})

const { port } = workerData as { port: number }

// Minion is the actual HTTP and WS server implementation
// it is mean to run in Node.js worker_thread and handles:
// - HTTP requests
// - WS subscriptions requests
// - WS data publishing to connected clients

class Minion {
  private readonly _server: TemplatedApp
  private _apiVersion = '1'

  constructor() {
    this._server = this._initServer()
  }

  private _initServer() {
    const apiPrefix = `/v${this._apiVersion}`
    return App()
      .ws(`${apiPrefix}/streams`, {
        compression: SHARED_COMPRESSOR,
        maxPayloadLength: 512 * 1024,
        idleTimeout: 30, // closes WS connection if no message/ping send/received in 30s
        maxBackpressure: 4 * 1024, // close if client is too slow to read the data fast enough
        message: (ws, message) => {
          this._handleSubscriptionRequest(ws, message)
        }
      })
      .get(`${apiPrefix}/markets`, listMarkets)
  }

  public async start(port: number) {
    return new Promise((resolve, reject) => {
      this._server.listen(port, (listenSocket) => {
        if (listenSocket) {
          debug(`listening on port ${port}`)
          resolve()
        } else {
          const message = `failed to listen on port ${port}`
          debug(message)
          reject(new Error(message))
        }
      })
    })
  }

  public async publish(message: DataMessage) {
    const market = PUB_TOPIC_NAME_FOR_MARKET[message.symbol]
    this._server.publish(`${message.type}/${market}`, JSON.stringify(message))
  }

  private _handleSubscriptionRequest(ws: WebSocket, buffer: ArrayBuffer) {
    try {
      const message = Buffer.from(buffer)
      const request = JSON.parse(message as any) as SubRequest

      const validationResult = this._validateRequestPayload(request)

      if (validationResult.isValid === false) {
        debug('invalid subscription message received: %o. Error: %s', request, message)

        const errorMessage: ErrorResponse = {
          type: 'error',
          message: validationResult.error,
          timestamp: new Date()
        }

        ws.send(JSON.stringify(errorMessage))

        return
      }

      // 'unpack' channel to specific message types that will be published for it
      const requestedTypes = MESSAGE_TYPES_PER_CHANNEL[request.channel]

      for (const type of requestedTypes) {
        for (const market of request.markets) {
          const safeMarketName = PUB_TOPIC_NAME_FOR_MARKET[market]
          if (request.op === 'subscribe') {
            ws.subscribe(`${type}/${safeMarketName}`)
          } else {
            ws.unsubscribe(`${type}/${safeMarketName}`)
          }
        }
      }

      if (request.op == 'subscribe') {
        if (requestedTypes.includes('l2snapshot')) {
          // TODO: send L2 snapshot for requested market
        }
        if (requestedTypes.includes('orders')) {
          // TODO: send L3 snapshot for requested market
        }
      }

      const successMessage: SuccessResponse = {
        type: request.op == 'subscribe' ? 'subscribed' : 'unsubscribed',
        channel: request.channel,
        markets: request.markets,
        timestamp: new Date()
      }

      ws.send(JSON.stringify(successMessage))
      debug('subscription succeeded %o', request)
    } catch (exception) {
      debug('subscription request error, %o', exception)
      // try catch just in case socket is already closed so it would throw
      try {
        ws.end(1011, 'subscription request error')
      } catch {}
    }
  }

  _validateRequestPayload(payload: SubRequest) {
    if (OPS.includes(payload.op) === false) {
      return {
        isValid: false,
        error: `Invalid op: '${payload.op}'.${getDidYouMean(payload.op, OPS)} ${getAllowedValuesText(OPS)}`
      } as const
    }

    if (CHANNELS.includes(payload.channel) === false) {
      return {
        isValid: false,
        error: `Invalid channel provided: '${payload.channel}'.${getDidYouMean(payload.channel, CHANNELS)}  ${getAllowedValuesText(
          CHANNELS
        )}`
      } as const
    }

    if (!Array.isArray(payload.markets) || payload.markets.length === 0) {
      return {
        isValid: false,
        error: `Invalid markets array provided.`
      } as const
    }

    if (payload.markets.length > 50) {
      return {
        isValid: false,
        error: `Too large markets array provided (> 50 items).`
      } as const
    }

    for (const market of payload.markets) {
      if (MARKETS_SYMBOLS.includes(market) === false) {
        return {
          isValid: false,
          error: `Invalid market provided: '${market}'.${getDidYouMean(market, MARKETS_SYMBOLS)}.`
        } as const
      }
    }

    return {
      isValid: true,
      error: undefined
    } as const
  }
}

const minion = new Minion()

minion.start(port).then(() => {
  parentPort!.on('message', (message) => {
    minion.publish(message)
    // TODO: process messages too to keep current order book state
  })
})
