import { Market, MARKETS, Orderbook } from '@project-serum/serum'
import { Order } from '@project-serum/serum/lib/market'
import { AccountInfo, Connection } from '@solana/web3.js'
import { PassThrough } from 'stream'
import { createDebugLogger } from './debug'
import { DataMessage, L2, PriceLevel } from './types'

const debug = createDebugLogger('serum-producer')

// SerumProducer responsibility is to:
// - connect to Serum Node RPC API via WS and subscribe to it's data feed for all supported markets
// - normalize received data and produce normalized data messages

export class SerumProducer {
  private _buffer = new PassThrough({
    objectMode: true,
    highWaterMark: 8096
  })

  constructor(private readonly _options: { nodeEndpoint: string }) {}

  public async start() {
    debug('starting...')
    const connection = new Connection(this._options.nodeEndpoint)

    await Promise.all(
      MARKETS.map(async (market) => {
        await this._startProducerForMarket(market, connection)
      })
    )

    debug('started')
  }

  public async *produce() {
    // return async iterable iterator of produced data messages
    for await (const message of this._buffer) {
      yield message as DataMessage
    }
  }

  private async _startProducerForMarket(marketMeta: typeof MARKETS[0], connection: Connection) {
    const market = await Market.load(connection, marketMeta.address, undefined, marketMeta.programId)

    const onBidsChange = this._onBidsAccountChanged(marketMeta.name, market)
    // first request for bids account data so we have initial bids ready
    const bidsResponse = await connection.getAccountInfo(market.bidsAddress)
    onBidsChange(bidsResponse!)
    // then subscribe for bids account changes
    connection.onAccountChange(market.bidsAddress, onBidsChange, 'recent')

    // TODO: asks
    // TODO: events queue
    // TODO: request queue
    // TODO: data normalization
    // TODO: book differ
  }

  private _onBidsAccountChanged(symbol: string, market: Market) {
    let lastSeenAccountData: Buffer | undefined = undefined
    return (account: AccountInfo<Buffer>) => {
      // same data as for last update skip it
      if (lastSeenAccountData !== undefined && lastSeenAccountData.equals(account.data)) {
        return
      }
      lastSeenAccountData = account.data

      // TODO: handle it properly, diffs only etc
      const lastBidsOrders = [...Orderbook.decode(market, account.data)]
      const message: L2 = {
        type: 'l2update',
        symbol,
        asks: [],
        bids: lastBidsOrders.reduce(this._reduceToL2, [] as [number, number][]),
        timestamp: new Date()
      }

      this._buffer.write(message)
    }
  }

  private _reduceToL2(previous: PriceLevel[], current: Order) {
    const matchingPriceLevel = previous.find((l) => l[0] === current.price)
    if (matchingPriceLevel !== undefined) {
      matchingPriceLevel[1] += current.size
    } else {
      previous.push([current.price, current.size])
    }

    return previous
  }
}
