import { App, TemplatedApp, WebSocket, us_listen_socket_close } from 'uWebSockets.js'
import { listMarkets } from './http'

export class SerumMachine {
  private readonly _server: TemplatedApp
  private _listenSocket: any = undefined
  private _apiVersion = '1'

  constructor(private readonly _: Options) {
    this._server = this._initServer()
  }

  private _initServer() {
    const apiPrefix = `/v${this._apiVersion}`
    return App()
      .ws(`${apiPrefix}/streams`, {
        open: (_: WebSocket) => {},

        message: (ws: WebSocket, message: ArrayBuffer) => {
          if (ws.onmessage !== undefined) {
            ws.onmessage(message)
          }
        },

        close: (ws: WebSocket) => {
          ws.closed = true
          if (ws.onclose !== undefined) {
            ws.onclose()
          }
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
  nodeEndpoint?: string
}
