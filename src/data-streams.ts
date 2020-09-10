import { MARKETS, Market, Orderbook } from '@project-serum/serum'
import { Connection } from '@solana/web3.js'
import { TemplatedApp, WebSocket } from 'uWebSockets.js'
import { debug } from './debug'
import { getAllowedValuesText, getDidYouMean } from './helpers'
import { Order } from '@project-serum/serum/lib/market'
import { SubRequest, ErrorResponse, L2, Message, SuccessResponse } from './types'
import { MESSAGE_TYPES_PER_CHANNEL, OPS, CHANNELS, MARKETS_SYMBOLS, PUB_TOPIC_NAME_FOR_MARKET } from './consts'

export class DataStreams {
  // TODO: that flag should be per-market (set to true only when we got bids & asks orders already fetched)
  private _publishersInitialized = false

  constructor(
    private readonly _app: TemplatedApp,
    private readonly _options: {
      nodeEndpoint: string
    }
  ) {}

  public handleSubscriptionRequest(ws: WebSocket, message: ArrayBuffer) {
    try {
      const request = JSON.parse(Buffer.from(message) as any) as SubRequest

      const validationResult = this._validateRequestPayload(request)

      if (validationResult.isValid === false) {
        debug('Invalid subscription message received: %o. Error: %o', request, message)

        const errorMessage: ErrorResponse = {
          type: 'error',
          message: validationResult.error,
          timestamp: new Date()
        }

        ws.send(JSON.stringify(errorMessage))

        return
      }

      if (this._publishersInitialized === false) {
        debug('Subscription request failed, server not yet initialized')

        const errorMessage: ErrorResponse = {
          type: 'error',
          message: 'Subscription request failed, server not yet initialized',
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
        if (requestedTypes.includes('l3snapshot')) {
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
      debug('Subscription succeeded %o', request, message)
    } catch (exception) {
      debug('Subscription request error, %o', exception)
      // try catch just in case socket is already closed so it would throw
      try {
        ws.end(1011, 'subscription request error')
      } catch {}
    }
  }

  public async setUpPublishers() {
    debug('Setting up publishers...')
    const connection = new Connection(this._options.nodeEndpoint)

    await Promise.all(
      MARKETS.map(async (market) => {
        await this._setUpPublisherForMarket(market, connection)
      })
    )

    this._publishersInitialized = true

    debug('Setting up publishers finished.')
  }

  private async _setUpPublisherForMarket(marketMeta: typeof MARKETS[0], connection: Connection) {
    const safeMarketName = PUB_TOPIC_NAME_FOR_MARKET[marketMeta.name]
    const market = await Market.load(connection, marketMeta.address, undefined, marketMeta.programId)

    // listen to order book bids account for bids changes
    connection.onAccountChange(
      market.bidsAddress,
      (account) => {
        // same data  as for last update skip it
        // if (lastSeenBidsData !== undefined && lastSeenBidsData.equals(account.data)) {
        //   return
        // }
        // lastSeenBidsData = account.data
        const lastBidsOrders = [...Orderbook.decode(market, account.data)]
        const message: L2 = {
          type: 'l2update',
          symbol: marketMeta.name,
          asks: [],
          bids: lastBidsOrders.reduce(this._reduceToL2, [] as [number, number][]),
          timestamp: new Date()
        }
        this._publish(safeMarketName, message)

        // const snapshot = mapToBookSnapshot(lastBidsOrders || [], lastAsksOrders || [], name)
        // marketDataStream.write(snapshot)
        // app.publish('tralala')
      },
      'recent'
    )

    // TODO: asks changes
    // TODO: fills changes
    // TODO: request queue changes
  }

  private _publish(market: string, message: Message) {
    this._app.publish(`${message.type}/${market}`, JSON.stringify(message))
  }

  private _reduceToL2(previous: [number, number][], current: Order) {
    const matchingPriceLevel = previous.find((l) => l[0] === current.price)
    if (matchingPriceLevel !== undefined) {
      matchingPriceLevel[1] += current.size
    } else {
      previous.push([current.price, current.size])
    }

    return previous
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
        error: `Too long markets array provided (> 50 items).`
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
