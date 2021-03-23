import { EVENT_QUEUE_LAYOUT, Market, Orderbook, getLayoutVersion } from '@project-serum/serum'
import { Event } from '@project-serum/serum/lib/queue'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { CircularBuffer } from './helpers'
import { logger } from './logger'
import { AccountsNotificationPayload } from './rpc_client'
import { MessageEnvelope } from './serum_producer'
import {
  Change,
  DataMessage,
  Done,
  EventQueueHeader,
  Fill,
  L2,
  L3Snapshot,
  Open,
  OrderItem,
  PriceLevel,
  Quote,
  RecentTrades,
  Trade
} from './types'

// DataMapper maps bids, asks and evenQueue accounts data to normalized messages
export class DataMapper {
  private _bidsAccountOrders: OrderItem[] | undefined = undefined
  private _asksAccountOrders: OrderItem[] | undefined = undefined

  private _bidsAccountSlabItems: SlabItem[] | undefined = undefined
  private _asksAccountSlabItems: SlabItem[] | undefined = undefined

  // _local* are used only for verification purposes
  private _localBidsOrders: OrderItem[] | undefined = undefined
  private _localAsksOrders: OrderItem[] | undefined = undefined

  private _initialized = false
  private _lastSeenSeqNum: number | undefined = undefined

  private _currentL2Snapshot:
    | {
        asks: PriceLevel[]
        bids: PriceLevel[]
      }
    | undefined = undefined

  private _currentQuote:
    | {
        readonly bestAsk: PriceLevel | undefined
        readonly bestBid: PriceLevel | undefined
      }
    | undefined = undefined

  private readonly _version: number
  private _zeroWithPrecision: string

  private readonly _recentTrades: CircularBuffer<Trade> = new CircularBuffer(100)

  constructor(
    private readonly _options: {
      readonly symbol: string
      readonly market: Market
      readonly priceDecimalPlaces: number
      readonly sizeDecimalPlaces: number
      readonly validateL3Diffs: boolean
    }
  ) {
    this._version = getLayoutVersion(this._options.market.programId) as number
    const zero = 0
    this._zeroWithPrecision = zero.toFixed(this._options.sizeDecimalPlaces)
  }

  public *map({ accountsData, slot }: AccountsNotificationPayload): IterableIterator<MessageEnvelope> {
    // the same timestamp for all messages received in single notification
    const timestamp = new Date().toISOString()

    const l3Diff: (Open | Fill | Done | Change)[] = []

    if (this._initialized && accountsData.eventQueue !== undefined) {
      let fillsIds: string[] = []
      for (const event of this._getNewlyAddedEvents(accountsData.eventQueue)) {
        const message = this._mapEventToDataMessage(event, timestamp, slot, fillsIds)
        if (message === undefined) {
          continue
        }
        if (message.type === 'fill') {
          fillsIds.push(message.orderId)
        }

        l3Diff.push(message)
      }
    }

    if (accountsData.asks !== undefined) {
      const newAsksSlabItems = [...Orderbook.decode(this._options.market, accountsData.asks).slab.items(false)]
      const newAsksOrders = newAsksSlabItems.map(this._mapAskSlabItemToOrder)

      if (this._initialized) {
        const currentAsksMap = new Map(this._asksAccountOrders!.map(this._toMapConstructorStructure))

        for (const ask of newAsksOrders) {
          const matchingExistingOrder = currentAsksMap.get(ask.orderId)
          const message = this._mapChangedOrderItemsToMessage(matchingExistingOrder, ask, timestamp, slot, l3Diff)

          if (message !== undefined) {
            // unshift as open/change messages should be processed before fill/done
            l3Diff.unshift(message)
          }
        }
      }

      this._asksAccountSlabItems = newAsksSlabItems
      this._asksAccountOrders = newAsksOrders
    }

    if (accountsData.bids !== undefined) {
      const newBidsSlabItems = [...Orderbook.decode(this._options.market, accountsData.bids).slab.items(true)]
      const newBidsOrders = newBidsSlabItems.map(this._mapBidSlabItemToOrder)

      if (this._initialized) {
        const currentBidsMap = new Map(this._bidsAccountOrders!.map(this._toMapConstructorStructure))

        for (const bid of newBidsOrders) {
          const matchingExistingOrder = currentBidsMap.get(bid.orderId)
          const message = this._mapChangedOrderItemsToMessage(matchingExistingOrder, bid, timestamp, slot, l3Diff)

          if (message !== undefined) {
            // unshift as open/change messages should be processed before fill/done
            l3Diff.unshift(message)
          }
        }
      }

      this._bidsAccountSlabItems = newBidsSlabItems
      this._bidsAccountOrders = newBidsOrders
    }

    if (this._options.validateL3Diffs && this._initialized && l3Diff.length > 0) {
      this._validateL3DiffCorrectness(l3Diff)
    }

    // initialize only when we have both asks and bids accounts data
    const shouldInitialize =
      this._initialized === false && this._asksAccountOrders !== undefined && this._bidsAccountOrders !== undefined

    const snapshotHasChanged =
      this._initialized === true && (accountsData.asks !== undefined || accountsData.bids !== undefined)

    if (shouldInitialize || snapshotHasChanged) {
      const l3Snapshot: L3Snapshot = {
        type: 'l3snapshot',
        market: this._options.symbol,
        timestamp,
        slot,
        version: this._version,
        asks: this._asksAccountOrders!,
        bids: this._bidsAccountOrders!
      }

      const publish = this._initialized === false
      this._initialized = true

      yield this._putInEnvelope(l3Snapshot, publish)
    }

    if (this._initialized === false) {
      return
    }

    if (this._currentL2Snapshot === undefined) {
      this._currentL2Snapshot = {
        asks: this._mapToL2Snapshot(this._asksAccountSlabItems!),
        bids: this._mapToL2Snapshot(this._bidsAccountSlabItems!)
      }

      const l2SnapshotMessage: L2 = {
        type: 'l2snapshot',
        market: this._options.symbol,
        timestamp,
        slot,
        version: this._version,
        asks: this._currentL2Snapshot.asks,
        bids: this._currentL2Snapshot.bids
      }

      this._currentQuote = {
        bestAsk: this._currentL2Snapshot.asks[0],
        bestBid: this._currentL2Snapshot.bids[0]
      }

      const quoteMessage: Quote = {
        type: 'quote',
        market: this._options.symbol,
        timestamp,
        slot,
        version: this._version,
        bestAsk: this._currentQuote.bestAsk,
        bestBid: this._currentQuote.bestBid
      }

      yield this._putInEnvelope(l2SnapshotMessage, true)
      yield this._putInEnvelope(quoteMessage, true)
    }

    // if account data has not changed, use current snapshot data
    // otherwise map new account data to l2
    const newL2Snapshot = {
      asks:
        accountsData.asks !== undefined
          ? this._mapToL2Snapshot(this._asksAccountSlabItems!)
          : this._currentL2Snapshot.asks,

      bids:
        accountsData.bids !== undefined
          ? this._mapToL2Snapshot(this._bidsAccountSlabItems!)
          : this._currentL2Snapshot.bids
    }

    const newQuote = {
      bestAsk: newL2Snapshot.asks[0],
      bestBid: newL2Snapshot.bids[0]
    }

    const asksDiff =
      accountsData.asks !== undefined ? this._getL2Diff(this._currentL2Snapshot.asks, newL2Snapshot.asks) : []

    const bidsDiff =
      accountsData.bids !== undefined ? this._getL2Diff(this._currentL2Snapshot.bids, newL2Snapshot.bids) : []

    if (l3Diff.length > 0) {
      for (const message of l3Diff) {
        yield this._putInEnvelope(message, true)

        // detect l2 trades based on fills
        if (message.type === 'fill' && message.maker === false) {
          const tradeId = `${message.orderId}|${message.size}|${new Date(timestamp).valueOf()}`

          const tradeMessage: Trade = {
            type: 'trade',
            market: this._options.symbol,
            timestamp,
            slot,
            version: this._version,
            id: tradeId,
            side: message.side,
            price: message.price,
            size: message.size
          }

          yield this._putInEnvelope(tradeMessage, true)

          this._recentTrades.append(tradeMessage)

          const recentTradesMessage: RecentTrades = {
            type: 'recent_trades',
            market: this._options.symbol,
            timestamp,
            trades: [...this._recentTrades.items()]
          }

          yield this._putInEnvelope(recentTradesMessage, false)
        }
      }
    }

    if (asksDiff.length > 0 || bidsDiff.length > 0) {
      // since we have a diff it means snapshot has changed
      // so we need to pass new snapshot to minions, just without 'publish' flag
      this._currentL2Snapshot = newL2Snapshot

      const l2Snapshot: L2 = {
        type: 'l2snapshot',
        market: this._options.symbol,
        timestamp,
        slot,
        version: this._version,
        asks: this._currentL2Snapshot.asks,
        bids: this._currentL2Snapshot.bids
      }
      const l2UpdateMessage: L2 = {
        type: 'l2update',
        market: this._options.symbol,
        timestamp,
        slot,
        version: this._version,
        asks: asksDiff,
        bids: bidsDiff
      }

      // first goes update
      yield this._putInEnvelope(l2UpdateMessage, true)
      // then snapshot, as new snapshot already includes update
      yield this._putInEnvelope(l2Snapshot, false)

      const quoteHasChanged =
        this._l2LevelChanged(this._currentQuote!.bestAsk, newQuote.bestAsk) ||
        this._l2LevelChanged(this._currentQuote!.bestBid, newQuote.bestBid)

      if (quoteHasChanged) {
        this._currentQuote = newQuote

        const quoteMessage: Quote = {
          type: 'quote',
          market: this._options.symbol,
          timestamp,
          slot,
          version: this._version,
          bestAsk: this._currentQuote.bestAsk,
          bestBid: this._currentQuote.bestBid
        }

        yield this._putInEnvelope(quoteMessage, true)
      }
    }
  }

  private _mapChangedOrderItemsToMessage(
    matchingExistingOrder: OrderItem | undefined,
    newOrder: OrderItem,
    timestamp: string,
    slot: number,
    l3Diff: (Open | Fill | Done | Change)[]
  ) {
    if (matchingExistingOrder === undefined) {
      const matchingFills = l3Diff.filter((i) => i.type === 'fill' && i.orderId === newOrder.orderId)
      let size = newOrder.size

      if (matchingFills.length > 0) {
        for (const matchingFill of matchingFills) {
          // add matching fill size to open order size
          // so when open and fill events are consumed, provide correct info
          size = (Number(size) + Number((matchingFill as any).size)).toFixed(this._options.sizeDecimalPlaces)
        }
      }

      return this._mapToOrderMessage(newOrder, 'open', size, timestamp, slot)
    } else if (
      matchingExistingOrder.size !== newOrder.size &&
      l3Diff.some((i) => i.type === 'fill' && i.orderId === newOrder.orderId && i.maker) === false
    ) {
      // we have order change, can happen when  SelfTradeBehavior::DecrementTake?
      return this._mapToOrderMessage(newOrder, 'change', newOrder.size, timestamp, slot)
    }

    return
  }

  public reset() {
    this._initialized = false
    this._lastSeenSeqNum = undefined
    this._bidsAccountOrders = undefined
    this._asksAccountOrders = undefined
    this._localBidsOrders = undefined
    this._localAsksOrders = undefined
    this._currentL2Snapshot = undefined
    this._currentQuote = undefined
  }

  private _validateL3DiffCorrectness(l3Diff: (Open | Fill | Done | Change)[]) {
    // first make sure we have initial snapshots to apply diffs to

    if (this._localAsksOrders === undefined && this._localBidsOrders === undefined) {
      this._localAsksOrders = this._asksAccountOrders
      this._localBidsOrders = this._bidsAccountOrders
      return
    }

    for (const item of l3Diff) {
      const orders = (item.side === 'buy' ? this._localBidsOrders : this._localAsksOrders)!
      if (item.type === 'open') {
        orders.push({
          orderId: item.orderId,
          clientId: item.clientId,
          side: item.side,
          price: item.price,
          size: item.size,
          account: item.account,
          accountSlot: item.accountSlot,
          feeTier: item.feeTier
        })
      }

      if (item.type === 'fill') {
        const matchingOrder = orders.find((o) => o.orderId === item.orderId)

        if (matchingOrder !== undefined) {
          ;(matchingOrder as any).size = (Number((matchingOrder as any).size) - Number(item.size)).toFixed(
            this._options.sizeDecimalPlaces
          )
        }
      }

      if (item.type === 'change') {
        const matchingOrder = orders.find((o) => o.orderId === item.orderId)
        ;(matchingOrder as any).size = item.size
      }

      if (item.type === 'done') {
        const indexToRemove = orders.findIndex((o) => o.orderId === item.orderId)
        if (indexToRemove !== -1) {
          orders.splice(indexToRemove, 1)
        }
      }
    }

    if (this._bidsAccountOrders!.length !== this._localBidsOrders!.length) {
      logger.log('error', 'Invalid bids diff', {
        l3Diff,
        bidsAccountOrders: this._bidsAccountOrders,
        localBidsOrders: this._localBidsOrders
      })

      return
    }

    for (let bid of this._bidsAccountOrders!) {
      const matchingLocalBid = this._localBidsOrders!.find((b) => b.orderId === bid.orderId)
      if (
        matchingLocalBid === undefined ||
        matchingLocalBid.price !== bid.price ||
        matchingLocalBid.size !== bid.size
      ) {
        logger.log('error', 'Invalid bids diff', {
          l3Diff,
          bidsAccountOrders: this._bidsAccountOrders,
          localBidsOrders: this._localBidsOrders,
          bid,
          matchingLocalBid
        })
        return
      }
    }

    if (this._asksAccountOrders!.length !== this._localAsksOrders!.length) {
      logger.log('error', 'Invalid asks diff', {
        l3Diff,
        asksAccountOrders: this._asksAccountOrders,
        localAsksOrders: this._localAsksOrders
      })
      return
    }

    for (let ask of this._asksAccountOrders!) {
      const matchingLocalAsk = this._localAsksOrders!.find((a) => a.orderId === ask.orderId)
      if (
        matchingLocalAsk === undefined ||
        matchingLocalAsk.price !== ask.price ||
        matchingLocalAsk.size !== ask.size
      ) {
        logger.log('error', 'Invalid asks diff', {
          l3Diff,
          asksAccountOrders: this._asksAccountOrders,
          localAsksOrders: this._localAsksOrders,
          ask,
          matchingLocalAsk
        })
        return
      }
    }
  }

  // based on https://github.com/project-serum/serum-ts/blob/525786435d6893c1cc6a670b39a0ba575dd9cca6/packages/serum/src/market.ts#L1389
  private _mapToL2Snapshot(slabItems: SlabItem[]) {
    const levels: [BN, BN][] = []

    for (const { key, quantity } of slabItems) {
      const price = key.ushrn(64)

      if (levels.length > 0 && levels[levels.length - 1]![0].eq(price)) {
        levels[levels.length - 1]![1].iadd(quantity)
      } else {
        levels.push([price, quantity])
      }
    }

    return levels.map(this._mapToL2Level)
  }

  private _getL2Diff(currentLevels: PriceLevel[], newLevels: PriceLevel[]): PriceLevel[] {
    const currentLevelsMap = new Map(currentLevels)

    const l2Diff: PriceLevel[] = []

    for (const newLevel of newLevels) {
      const matchingCurrentLevelSize = currentLevelsMap.get(newLevel[0])

      if (matchingCurrentLevelSize !== undefined) {
        const levelSizeChanged = matchingCurrentLevelSize !== newLevel[1]

        if (levelSizeChanged) {
          l2Diff.push(newLevel)
        }
        // remove from current levels map so we know that such level exists in new levels
        currentLevelsMap.delete(newLevel[0])
      } else {
        // completely new price level
        l2Diff.push(newLevel)
      }
    }

    for (const levelToRemove of currentLevelsMap) {
      const l2Delete: PriceLevel = [levelToRemove[0], this._zeroWithPrecision]

      l2Diff.unshift(l2Delete)
    }

    return l2Diff
  }

  private _l2LevelChanged(currentLevel: PriceLevel | undefined, newLevel: PriceLevel | undefined) {
    if (currentLevel === undefined && newLevel === undefined) {
      return false
    }

    if (currentLevel === undefined && newLevel !== undefined) {
      return true
    }

    if (currentLevel !== undefined && newLevel === undefined) {
      return true
    }

    // price has changed
    if (currentLevel![0] !== newLevel![0]) {
      return true
    }

    // size has changed
    if (currentLevel![1] !== newLevel![1]) {
      return true
    }

    return false
  }

  private _mapToL2Level = (level: [BN, BN]): PriceLevel => {
    const price = this._options.market.priceLotsToNumber(level[0]).toFixed(this._options.priceDecimalPlaces)
    const size = this._options.market.baseSizeLotsToNumber(level[1]).toFixed(this._options.sizeDecimalPlaces)

    return [price, size]
  }

  private _putInEnvelope(message: DataMessage | RecentTrades, publish: boolean) {
    const envelope: MessageEnvelope = {
      type: message.type,
      market: message.market,
      publish,
      payload: JSON.stringify(message),
      timestamp: message.timestamp
    }

    return envelope
  }

  private _toMapConstructorStructure(orderItem: OrderItem): [string, OrderItem] {
    return [orderItem.orderId, orderItem]
  }

  private _mapEventToDataMessage(
    event: Event,
    timestamp: string,
    slot: number,
    fillsIds: string[]
  ): Fill | Done | Change | undefined {
    const clientId = (event as any).clientOrderId ? (event as any).clientOrderId.toString() : undefined

    const side = event.eventFlags.bid ? 'buy' : 'sell'
    const orderId = event.orderId.toString()
    const openOrdersAccount = event.openOrders.toBase58()
    const openOrdersSlot = event.openOrdersSlot
    const feeTier = event.feeTier

    if (event.eventFlags.fill) {
      const fillMessage: Fill = {
        type: 'fill',
        market: this._options.symbol,
        timestamp,
        slot,
        version: this._version,
        orderId,
        clientId,
        side,
        price: this._getFillPrice(event).toFixed(this._options.priceDecimalPlaces),
        size: this._getFillSize(event).toFixed(this._options.sizeDecimalPlaces),
        maker: event.eventFlags.maker,
        feeCost: this._options.market.quoteSplSizeToNumber(event.nativeFeeOrRebate) * (event.eventFlags.maker ? -1 : 1),
        account: openOrdersAccount,
        accountSlot: openOrdersSlot,
        feeTier: feeTier
      }
      return fillMessage
    } else if (event.nativeQuantityPaid.eqn(0)) {
      // we can use nativeQuantityPaid === 0 to detect if order is 'done'
      // this is what the dex uses at event processing time to decide if it can release the slot in an OpenOrders account.
      // done means that there won't be any more messages for the order (is no longer in the order book or never was - cancelled, ioc)

      const doneMessage: Done = {
        type: 'done',
        market: this._options.symbol,
        timestamp,
        slot,
        version: this._version,
        orderId,
        clientId,
        side,
        reason: fillsIds.includes(orderId) ? 'filled' : 'canceled',
        account: openOrdersAccount,
        accountSlot: openOrdersSlot
      }

      return doneMessage
    }

    return
  }

  private _getFillSize(event: Event) {
    return divideBnToNumber(
      event.eventFlags.bid ? event.nativeQuantityReleased : event.nativeQuantityPaid,
      (this._options.market as any)._baseSplTokenMultiplier
    )
  }

  private _getFillPrice(event: Event) {
    let priceBeforeFees

    if (event.eventFlags.bid) {
      priceBeforeFees = event.eventFlags.maker
        ? event.nativeQuantityPaid.add(event.nativeFeeOrRebate)
        : event.nativeQuantityPaid.sub(event.nativeFeeOrRebate)
    } else {
      priceBeforeFees = event.eventFlags.maker
        ? event.nativeQuantityReleased.sub(event.nativeFeeOrRebate)
        : event.nativeQuantityReleased.add(event.nativeFeeOrRebate)
    }

    const price = divideBnToNumber(
      priceBeforeFees.mul((this._options.market as any)._baseSplTokenMultiplier),
      (this._options.market as any)._quoteSplTokenMultiplier.mul(
        event.eventFlags.bid ? event.nativeQuantityReleased : event.nativeQuantityPaid
      )
    )

    return price
  }

  private *_getNewlyAddedEvents(eventQueueData: Buffer) {
    const { HEADER, NODE } = EVENT_QUEUE_LAYOUT
    const header = HEADER.decode(eventQueueData) as EventQueueHeader

    // based on seqNum provided by event queue we can calculate how many events have been added
    // to the queue since last update (header.seqNum - _lastSeenSeqNum)
    // if we don't have stored _lastSeenSeqNum it means it's first notification so let's just initialize _lastSeenSeqNum

    if (this._lastSeenSeqNum !== undefined) {
      const allocLen = Math.floor((eventQueueData.length - HEADER.span) / NODE.span)

      const newEventsCount = header.seqNum - this._lastSeenSeqNum

      for (let i = newEventsCount; i > 0; --i) {
        const nodeIndex = (header.head + header.count + allocLen - i) % allocLen
        const decodedItem = NODE.decode(eventQueueData, HEADER.span + nodeIndex * NODE.span) as Event

        yield decodedItem
      }
    }

    this._lastSeenSeqNum = header.seqNum
  }

  private _mapToOrderMessage(
    { orderId, clientId, side, price, account, accountSlot, feeTier }: OrderItem,
    type: 'open' | 'change',
    size: string,
    timestamp: string,
    slot: number
  ): Open | Change {
    return {
      type,
      market: this._options.symbol,
      timestamp,
      slot,
      version: this._version,
      orderId,
      clientId,
      side,
      price,
      size,
      account,
      accountSlot,
      feeTier
    }
  }

  private _mapAskSlabItemToOrder = (slabItem: SlabItem) => {
    return this._mapToOrderItem(slabItem, false)
  }

  private _mapBidSlabItemToOrder = (slabItem: SlabItem) => {
    return this._mapToOrderItem(slabItem, true)
  }

  // based on https://github.com/project-serum/serum-ts/blob/525786435d6893c1cc6a670b39a0ba575dd9cca6/packages/serum/src/market.ts#L1414
  private _mapToOrderItem = (
    { key, clientOrderId, feeTier, ownerSlot, owner, quantity }: SlabItem,
    isBids: boolean
  ) => {
    const price = key.ushrn(64)

    const orderItem: OrderItem = {
      orderId: key.toString(),
      clientId: clientOrderId.toString(),
      side: isBids ? 'buy' : 'sell',
      price: this._options.market.priceLotsToNumber(price).toFixed(this._options.priceDecimalPlaces),
      size: this._options.market.baseSizeLotsToNumber(quantity).toFixed(this._options.sizeDecimalPlaces),
      account: owner.toBase58(),
      accountSlot: ownerSlot,
      feeTier
    }

    return orderItem
  }
}

// copy of https://github.com/project-serum/serum-ts/blob/70c4b08860b513618dfbc283e8c52e03e8b81d77/packages/serum/src/market.ts#L1434
function divideBnToNumber(numerator: BN, denominator: BN): number {
  const quotient = numerator.div(denominator).toNumber()
  const rem = numerator.umod(denominator)
  const gcd = rem.gcd(denominator)
  return quotient + rem.div(gcd).toNumber() / denominator.div(gcd).toNumber()
}

type SlabItem = {
  ownerSlot: number
  key: BN
  owner: PublicKey
  quantity: BN
  feeTier: number
  clientOrderId: BN
}
