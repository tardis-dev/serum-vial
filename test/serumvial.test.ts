import fetch from 'node-fetch'
import WebSocket from 'ws'
import { bootServer, stopServer, DataMessage, SerumListMarketItem, SubRequest, SuccessResponse } from '../dist'
import { wait } from '../dist/helpers'

const PORT = 8989
const TIMEOUT = 180 * 1000
const WS_ENDPOINT = `ws://localhost:${PORT}/v1/ws`

async function fetchMarkets() {
  const response = await fetch(`http://localhost:${PORT}/v1/markets`)

  return (await response.json()) as SerumListMarketItem[]
}

describe('serum-vial', () => {
  beforeAll(async () => {
    await bootServer({
      port: PORT,
      commitment: 'confirmed',
      validateL3Diffs: true,

      markets: [
        {
          address: 'HWHvQhFmJB3NUcu1aihKmrKegfVxBEHzwVX6yZCKEsi1',
          deprecated: false,
          name: 'SOL/USDT',
          programId: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'
        }
      ],
      minionsCount: 1,
      nodeEndpoint: 'https://solana-api.projectserum.com',
      wsEndpointPort: undefined
    })
  }, TIMEOUT)

  afterAll(async () => {
    await stopServer()
  })

  test(
    'HTTP GET /markets',
    async () => {
      const markets = await fetchMarkets()

      expect(markets).toMatchSnapshot()
    },
    TIMEOUT
  )

  test(
    'WS trades data stream',
    async () => {
      const wsClient = new SimpleWebsocketClient(WS_ENDPOINT)
      const markets = await fetchMarkets()

      const subscribeRequest: SubRequest = {
        op: 'subscribe',
        channel: 'trades',
        markets: markets.map((m) => m.name)
      }

      let receivedSubscribed = false
      let receivedRecentTrades = false

      await wsClient.send(subscribeRequest)
      let messagesCount = 0

      for await (const message of wsClient.stream()) {
        if (message.type === 'subscribed') {
          receivedSubscribed = true
        }

        if (message.type === 'recent_trades') {
          receivedRecentTrades = true
        }

        messagesCount++
        if (messagesCount == 2) {
          break
        }
      }

      expect(messagesCount).toBe(2)
      expect(receivedSubscribed).toBe(true)
      expect(receivedRecentTrades).toBe(true)
    },
    TIMEOUT
  )

  test(
    'WS level1 data stream',
    async () => {
      const wsClient = new SimpleWebsocketClient(WS_ENDPOINT)
      const markets = await fetchMarkets()

      const subscribeRequest: SubRequest = {
        op: 'subscribe',
        channel: 'level1',
        markets: markets.map((m) => m.name)
      }

      await wsClient.send(subscribeRequest)
      let l1MessagesCount = 0
      let receivedSubscribed = false
      let receivedQuoteMessage = false

      for await (const message of wsClient.stream()) {
        if (message.type === 'subscribed') {
          receivedSubscribed = true
        }

        if (message.type === 'quote') {
          receivedQuoteMessage = true
        }

        l1MessagesCount++
        if (l1MessagesCount == 10) {
          break
        }
      }

      expect(l1MessagesCount).toBe(10)
      expect(receivedSubscribed).toBe(true)
      expect(receivedQuoteMessage).toBe(true)
    },
    TIMEOUT
  )

  test(
    'WS level2 data stream',
    async () => {
      const wsClient = new SimpleWebsocketClient(WS_ENDPOINT)
      const markets = await fetchMarkets()
      let receivedSubscribed = false
      let receivedSnapshot = false

      const subscribeRequest: SubRequest = {
        op: 'subscribe',
        channel: 'level2',
        markets: markets.map((m) => m.name)
      }

      await wsClient.send(subscribeRequest)
      let l2MessagesCount = 0

      for await (const message of wsClient.stream()) {
        if (message.type === 'subscribed') {
          receivedSubscribed = true
        }

        if (message.type === 'l2snapshot') {
          receivedSnapshot = true
        }

        l2MessagesCount++
        if (l2MessagesCount == 10) {
          break
        }
      }

      expect(l2MessagesCount).toBe(10)
      expect(receivedSnapshot).toBe(true)
      expect(receivedSubscribed).toBe(true)
    },
    TIMEOUT
  )

  test(
    'WS level3 data stream',
    async () => {
      const wsClient = new SimpleWebsocketClient(WS_ENDPOINT)
      const markets = await fetchMarkets()

      const subscribeRequest: SubRequest = {
        op: 'subscribe',
        channel: 'level3',
        markets: markets.map((m) => m.name)
      }

      let receivedSubscribed = false
      let receivedSnapshot = false

      await wsClient.send(subscribeRequest)
      let l3MessagesCount = 0

      for await (const message of wsClient.stream()) {
        if (message.type === 'subscribed') {
          receivedSubscribed = true
        }

        if (message.type === 'l3snapshot') {
          receivedSnapshot = true
        }

        l3MessagesCount++
        if (l3MessagesCount == 20) {
          break
        }
      }

      expect(l3MessagesCount).toBe(20)
      expect(receivedSubscribed).toBe(true)
      expect(receivedSnapshot).toBe(true)
    },
    TIMEOUT
  )

  class SimpleWebsocketClient {
    private readonly _socket: WebSocket

    constructor(url: string) {
      this._socket = new WebSocket(url)
    }

    public async send(payload: any) {
      while (this._socket.readyState !== WebSocket.OPEN) {
        await wait(100)
      }
      this._socket.send(JSON.stringify(payload))
    }

    public async *stream() {
      const realtimeMessagesStream = (WebSocket as any).createWebSocketStream(this._socket, {
        readableObjectMode: true
      }) as AsyncIterableIterator<Buffer>

      for await (let messageBuffer of realtimeMessagesStream) {
        const message = JSON.parse(messageBuffer as any)
        yield message as DataMessage | SuccessResponse
      }
    }
  }
})
