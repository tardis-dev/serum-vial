import { Market } from '@project-serum/serum'
import { AccountInfo, Connection, Context } from '@solana/web3.js'
import { isMainThread, threadId, workerData } from 'worker_threads'
import { MessageType } from './consts'
import { DataMapper } from './data_mapper'
import { decimalPlaces, serumDataChannel, serumProducerReadyChannel } from './helpers'
import { logger } from './logger'
import { ACTIVE_MARKETS } from './markets'

logger.defaultMeta = {
  producerId: threadId
}

if (isMainThread) {
  const message = 'Exiting. Worker is not meant to run in main thread'
  logger.error(message)

  throw new Error(message)
}

process.on('unhandledRejection', (err) => {
  throw err
})

// SerumProducer responsibility is to:
// - connect to Serum Node RPC API via WS and subscribe to single Serum market
// - map received data to normalized data messages and broadcast those

export class SerumProducer {
  constructor(private readonly _options: { nodeEndpoint: string; testMode: boolean; marketName: string }) {}

  public async start(onData: OnDataCallback) {
    logger.info(`Serum Producer starting for  ${this._options.marketName} market ...`)

    const marketMeta = ACTIVE_MARKETS.find((m) => m.name == this._options.marketName)!

    const connection = new Connection(this._options.nodeEndpoint)

    const market = await Market.load(connection, marketMeta.address, undefined, marketMeta.programId)

    const accountsNotification = new AccountsChangeNotification(connection, market)

    accountsNotification.onAccountsChange = this._processMarketsAccountsChange(marketMeta.name, market, onData)

    logger.info(`Serum Producer started for  ${this._options.marketName} market ...`)
  }

  private _processMarketsAccountsChange(symbol: string, market: Market, onData: OnDataCallback) {
    const priceDecimalPlaces = decimalPlaces(market.tickSize)
    const sizeDecimalPlaces = decimalPlaces(market.minOrderSize)

    // przekazac test mode flag, wtedy produkuje snapshots
    const dataMapper = new DataMapper({
      symbol,
      market,
      priceDecimalPlaces,
      sizeDecimalPlaces,
      testMode: this._options.testMode
    })

    return (accountsData: AccountsData, slot: number, restarted: boolean) => {
      for (const message of dataMapper.map(accountsData, slot.toString(), restarted)) {
        onData(message)
      }
    }
  }
}

// this helper class handles RPC subscriptions to seprate DEX accounts (bids, asks & event queue)
// and provide notification in synchronized fashion, meaning  we get at most one notification per slot
// with accounts data that changed in that slot
//
// This way we always process accounts updates in the same order as single update
// otherwise we would end up processing eventsQueue changes before bids/asks if that would be
// the order of accountNotification messages returned by the server which would be wrong
//as we'd end up with 'fill' message published before 'open' message for example
//
// TODO: when https://github.com/solana-labs/solana/issues/12237 is implemented
// we'll be able to subscribe to multiple accounts at once and get rid of that helper class

class AccountsChangeNotification {
  private _currentSlot: number | undefined = undefined
  private _state: 'PRISTINE' | 'PENDING' | 'PUBLISHED' = 'PRISTINE'
  private _accountsData!: AccountsData
  private _publishTID: NodeJS.Timer | undefined = undefined
  public onAccountsChange:
    | ((accountsData: AccountsData, slot: number, restarted: boolean) => void)
    | undefined = undefined
  private _asksSubId: number | undefined = undefined
  private _bidsSubId: number | undefined = undefined
  private _eventQueueSubId: number | undefined = undefined
  private _restarted: boolean = false

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

    const commitment = 'singleGossip' as const

    this._connection.validatorExit

    this._asksSubId = this._connection.onAccountChange(this._market.asksAddress, onAccountChange('asks'), commitment)
    this._bidsSubId = this._connection.onAccountChange(this._market.bidsAddress, onAccountChange('bids'), commitment)
    this._eventQueueSubId = this._connection.onAccountChange(
      (this._market as any)._decoded.eventQueue,
      onAccountChange('eventQueue'),
      commitment
    )
  }

  private _restart() {
    this._restarted = true

    if (this._asksSubId !== undefined) {
      this._connection.removeAccountChangeListener(this._asksSubId)
    }

    if (this._bidsSubId !== undefined) {
      this._connection.removeAccountChangeListener(this._bidsSubId)
    }

    if (this._eventQueueSubId !== undefined) {
      this._connection.removeAccountChangeListener(this._eventQueueSubId)
    }

    this._resetAccountData()
    this._subscribeToAccountsChanges()
  }

  private _resetAccountData() {
    this._accountsData = {
      bids: undefined,
      asks: undefined,
      eventQueue: undefined
    }
  }
  private _publish = () => {
    if (this.onAccountsChange !== undefined) {
      this.onAccountsChange(this._accountsData, this._currentSlot!, this._restarted)
      this._restarted = false
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
      this._accountsData.eventQueue !== undefined
    )
  }

  private _update(accountName: 'bids' | 'asks' | 'eventQueue', accountData: Buffer, slot: number) {
    if (this._state === 'PUBLISHED') {
      // if after we published accounts notification
      // and for some reason next received notification is for already published slot or older
      // throw error as it's this is situation that should never happen
      if (slot <= this._currentSlot!) {
        throw new Error(
          `Out of order notification after publish: market: current slot ${this._currentSlot}, update slot: ${slot}`
        )
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
        logger.warning(
          `Out of order notification for pending event: current slot ${this._currentSlot}, update slot: ${slot}, restarting subscriptions...`
        )
        this._restart()
      }
    }
  }
}

const serumProducer = new SerumProducer(workerData)

serumProducer
  .start((envelope) => {
    serumDataChannel.postMessage(envelope)
  })
  .then(() => {
    serumProducerReadyChannel.postMessage('ready')
  })

export type MessageEnvelope = {
  type: MessageType
  symbol: string
  publish: boolean
  payload: string
  timestamp: number
}

type OnDataCallback = (envelope: MessageEnvelope) => void

export type AccountName = 'bids' | 'asks' | 'eventQueue'
export type AccountsData = { [key in AccountName]: Buffer | undefined }
