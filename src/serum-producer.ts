import { Market, MARKETS } from '@project-serum/serum'
import { AccountInfo, Connection, Context } from '@solana/web3.js'
import { PassThrough } from 'stream'
import { AsksBidsDataMapper, EventQueueDataMapper, RequestQueueDataMapper } from './data-mappers'
import { createDebugLogger } from './debug'
import { batch, decimalPlaces } from './helpers'
import { AccountName, AccountsData, L3DataMessage } from './types'

const debug = createDebugLogger('serum-producer')

// SerumProducer responsibility is to:
// - connect to Serum Node RPC API via WS and subscribe to it's data feed for all supported markets
// - normalize received data and produce normalized L3 data messages

export class SerumProducer {
  private _buffer = new PassThrough({
    objectMode: true,
    highWaterMark: 8096
  })

  constructor(private readonly _options: { nodeEndpoint: string }) {}

  public async start() {
    debug('starting...')

    for (const marketsBatch of batch(MARKETS, 5)) {
      await Promise.all(
        marketsBatch.map((market) => {
          return this._startProducerForMarket(market)
        })
      )
    }

    debug('started')
  }

  public async *produce() {
    // return async iterable iterator of produced data messages
    for await (const message of this._buffer) {
      yield message as L3DataMessage
    }
  }

  private async _startProducerForMarket(marketMeta: typeof MARKETS[0]) {
    // current connection strategy to RPC Node is to have separate WS connection per market
    const connection = new Connection(this._options.nodeEndpoint)

    const market = await Market.load(connection, marketMeta.address, undefined, marketMeta.programId)

    const accountsNotification = new AccountsNotification(connection, market)

    accountsNotification.onAccountsChange = this._processMarketsAccountsChange(marketMeta.name, market)
  }

  private _processMarketsAccountsChange(symbol: string, market: Market) {
    const priceDecimalPlaces = decimalPlaces(market.tickSize)
    const sizeDecimalPlaces = decimalPlaces(market.minOrderSize)

    const requestQueueDataMapper = new RequestQueueDataMapper(symbol, market, priceDecimalPlaces, sizeDecimalPlaces)
    const asksBidsDataMapper = new AsksBidsDataMapper(symbol, market, priceDecimalPlaces, sizeDecimalPlaces)
    const eventQueueDataMapper = new EventQueueDataMapper(symbol, market, priceDecimalPlaces, sizeDecimalPlaces)

    return (accountsData: AccountsData, context: Context) => {
      const timestamp = new Date().valueOf() // the same timestamp for all messages received in single notification
      const slot = context.slot.toString()

      if (accountsData.requestQueue !== undefined) {
        // map newly added request queue items to messages and publish
        for (const message of requestQueueDataMapper.map(accountsData.requestQueue, slot, timestamp)) {
          this._publishMessage(message)
        }
      }

      if (accountsData.asks !== undefined || accountsData.bids !== undefined) {
        for (const message of asksBidsDataMapper.map(accountsData.asks, accountsData.bids, slot, timestamp)) {
          this._publishMessage(message)
        }
      }

      if (accountsData.eventQueue !== undefined) {
        for (const message of eventQueueDataMapper.map(accountsData.eventQueue, slot, timestamp)) {
          this._publishMessage(message)
        }
      }
    }
  }

  private _publishMessage(message: L3DataMessage) {
    this._buffer.write(message)
  }
}

// this helper class handles RPC subscriptions to seprate DEX accounts (bids, asks, request & event queue)
// and provide notification in synchronized fashion, meaning  we get at most one notification per slot
// with accounts data that changed in that slot
//
// This way we always process accounts updates in the same order as single update
// otherwise we would end up processing eventsQueue changes before requestChanges if that would be
// the order of accountNotification messages returned by the server which would be wrong
//as we'd end up with 'done' message published before 'received' message for example
//
// TODO: when https://github.com/solana-labs/solana/issues/12237 is implemented
// we'll be able to subscribe to multiple accounts at once and get rid of that helper class

class AccountsNotification {
  private _currentSlot: number | undefined = undefined
  private _state: 'PRISTINE' | 'PENDING' | 'PUBLISHED' = 'PRISTINE'
  private _accountsData!: AccountsData
  private _publishTID: NodeJS.Timer | undefined = undefined
  public onAccountsChange: ((accountsData: AccountsData, context: Context) => void) | undefined = undefined

  constructor(private readonly _connection: Connection, private readonly _market: Market) {
    this._resetAccountData()
    this._subscribeToAccountsChanges()
  }

  private _subscribeToAccountsChanges() {
    const onAccountChange = (accountName: AccountName) => {
      return (account: AccountInfo<Buffer>, context: Context) => {
        this._update(accountName, account.data, context.slot)
      }
    }

    this._connection.onAccountChange(this._market.asksAddress, onAccountChange('asks'), 'recent')
    this._connection.onAccountChange(this._market.bidsAddress, onAccountChange('bids'), 'recent')
    this._connection.onAccountChange((this._market as any)._decoded.eventQueue, onAccountChange('eventQueue'), 'recent')
    this._connection.onAccountChange((this._market as any)._decoded.requestQueue, onAccountChange('requestQueue'), 'recent')
  }

  private _resetAccountData() {
    this._accountsData = {
      bids: undefined,
      asks: undefined,
      requestQueue: undefined,
      eventQueue: undefined
    }
  }
  private _publish = () => {
    if (this.onAccountsChange !== undefined) {
      this.onAccountsChange(this._accountsData, { slot: this._currentSlot! })
    }

    this._resetAccountData()

    if (this._publishTID !== undefined) {
      clearTimeout(this._publishTID)
      this._publishTID = undefined
    }

    this._state = 'PUBLISHED'
  }

  private _startPublishTimer() {
    // wait up to 400ms for remaining accounts notifications
    this._publishTID = setTimeout(this._publish, 400)
  }

  private _receivedDataForAllAccounts() {
    return (
      this._accountsData.bids !== undefined &&
      this._accountsData.asks !== undefined &&
      this._accountsData.eventQueue !== undefined &&
      this._accountsData.requestQueue !== undefined
    )
  }

  private _update(accountName: 'bids' | 'asks' | 'requestQueue' | 'eventQueue', accountData: Buffer, slot: number) {
    if (this._state === 'PUBLISHED') {
      // if after we published accounts notification
      // and for some reason next received notification is for already published slot or older
      // throw error as it's this is situation that should never happen
      if (slot <= this._currentSlot!) {
        throw new Error(`Out of order notification after publish: market: current slot ${this._currentSlot}, update slot: ${slot}`)
      } else {
        // otherwise move to pristine state
        this._state = 'PRISTINE'
      }
    }

    if (this._state === 'PRISTINE') {
      this._currentSlot = slot
      this._startPublishTimer()
      this._state = 'PENDING'
    }

    if (this._state === 'PENDING') {
      // event for the same slot, just update the data for account
      if (slot === this._currentSlot) {
        this._accountsData[accountName] = accountData
        // it's pending but since we have data for all accounts for current slot we can publish immediately
        if (this._receivedDataForAllAccounts()) {
          this._publish()
        }
      } else if (slot > this._currentSlot!) {
        // we received data for next slot, let's publish data for current slot
        this._publish()
        // and run the update again
        this._update(accountName, accountData, slot)
      } else {
        throw new Error(`Out of order notification for pending event: current slot ${this._currentSlot}, update slot: ${slot}`)
      }
    }
  }
}
