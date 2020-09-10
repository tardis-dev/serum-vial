import { App, TemplatedApp, us_listen_socket_close, SHARED_COMPRESSOR } from 'uWebSockets.js'
import { listMarkets } from './markets'
import { DataStreams } from './data-streams'

export class SerumMachine {
  private readonly _server: TemplatedApp
  private _listenSocket: any = undefined
  private _apiVersion = '1'
  private _dataStreams: DataStreams

  constructor(private readonly _options: Options) {
    this._server = this._initServer()
    this._dataStreams = new DataStreams(this._server, this._options)
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
          this._dataStreams.handleSubscriptionRequest(ws, message)
        }
      })
      .get(`${apiPrefix}/markets`, listMarkets)
  }

  public async start(port: number) {
    await new Promise((resolve, reject) => {
      try {
        this._server.listen(port, (listenSocket) => {
          this._listenSocket = listenSocket
          if (listenSocket) {
            this._dataStreams.setUpPublishers()
            resolve()
          } else {
            reject(new Error('Serum Machine server could not start'))
          }
        })
      } catch (e) {
        reject(e)
      }
    })
  }

  public async stop() {
    // shutdown uws server
    if (this._listenSocket !== undefined) {
      us_listen_socket_close(this._listenSocket)
    }
  }
}

type Options = {
  nodeEndpoint: string
}
