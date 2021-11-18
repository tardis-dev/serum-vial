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
  private _localBidsOrdersMap: Map<string, OrderItem> | undefined = undefined
  private _localAsksOrdersMap: Map<string, OrderItem> | undefined = undefined

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
      readonly onPartitionDetected: () => void
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

    const newAsksSlabItems =
      accountsData.asks !== undefined
        ? [...Orderbook.decode(this._options.market, accountsData.asks).slab.items(false)]
        : this._asksAccountSlabItems

    const newAsksOrders =
      accountsData.asks !== undefined && newAsksSlabItems !== undefined
        ? newAsksSlabItems.map(this._mapAskSlabItemToOrder)
        : this._asksAccountOrders

    const newBidsSlabItems =
      accountsData.bids !== undefined
        ? [...Orderbook.decode(this._options.market, accountsData.bids).slab.items(true)]
        : this._bidsAccountSlabItems

    const newBidsOrders =
      accountsData.bids !== undefined && newBidsSlabItems !== undefined
        ? newBidsSlabItems.map(this._mapBidSlabItemToOrder)
        : this._bidsAccountOrders

    if (this._initialized && accountsData.eventQueue !== undefined) {
      let fillsIds: Map<string, Fill> = new Map()
      for (const event of this._getNewlyAddedEvents(accountsData.eventQueue)) {
        // for maker fills check first if there's existing open order for it
        // as it may not exist in scenario where order was added to the order book and matched in the same slot

        if (event.eventFlags.fill === true && event.eventFlags.maker === true) {
          const makerFill: Fill = this._mapEventToDataMessage(event, timestamp, slot, fillsIds)! as Fill
          const currentOpenOrders = makerFill.side === 'buy' ? newBidsOrders! : newAsksOrders!
          const lastOpenOrders = makerFill.side === 'buy' ? this._bidsAccountOrders! : this._asksAccountOrders!

          const hasMatchingOpenOrder =
            currentOpenOrders.some((o) => o.orderId === makerFill.orderId) ||
            lastOpenOrders.some((o) => o.orderId === makerFill.orderId)

          if (hasMatchingOpenOrder === false) {
            const openMessage: Open = {
              type: 'open',
              market: this._options.symbol,
              timestamp,
              slot,
              version: this._version,
              orderId: makerFill.orderId,
              clientId: makerFill.clientId,
              side: makerFill.side,
              price: makerFill.price,
              size: makerFill.size,
              account: makerFill.account,
              accountSlot: makerFill.accountSlot,
              feeTier: makerFill.feeTier
            }

            l3Diff.push(openMessage)
          }
        }

        const message = this._mapEventToDataMessage(event, timestamp, slot, fillsIds)

        if (message === undefined) {
          continue
        }
        if (message.type === 'fill') {
          fillsIds.set(message.orderId, message)
        }

        l3Diff.push(message)
      }
    }

    if (accountsData.asks !== undefined) {
      if (this._initialized) {
        const currentAsksMap = new Map(this._asksAccountOrders!.map(this._toMapConstructorStructure))

        for (const ask of newAsksOrders!) {
          const matchingExistingOrder = currentAsksMap.get(ask.orderId)
          this._addChangedOrderItemsToL3Diff(matchingExistingOrder, ask, timestamp, slot, l3Diff)
        }
      }

      this._asksAccountSlabItems = newAsksSlabItems
      this._asksAccountOrders = newAsksOrders
    }

    if (accountsData.bids !== undefined) {
      if (this._initialized) {
        const currentBidsMap = new Map(this._bidsAccountOrders!.map(this._toMapConstructorStructure))

        for (const bid of newBidsOrders!) {
          const matchingExistingOrder = currentBidsMap.get(bid.orderId)
          this._addChangedOrderItemsToL3Diff(matchingExistingOrder, bid, timestamp, slot, l3Diff)
        }
      }

      this._bidsAccountSlabItems = newBidsSlabItems
      this._bidsAccountOrders = newBidsOrders
    }

    if (this._initialized) {
      const diffIsValid = this._validateL3DiffCorrectness(l3Diff)

      if (diffIsValid === false) {
        logger.log('warn', 'PartitionDetected: invalid l3diff', {
          market: this._options.symbol,
          asksAccountExists: accountsData.asks !== undefined,
          bidsAccountExists: accountsData.bids !== undefined,
          eventQueueAccountExists: accountsData.eventQueue !== undefined,
          slot,
          l3DiffLength: l3Diff.length
        })

        this._options.onPartitionDetected()

        return
      }
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

      const isInit = this._initialized === false
      if (isInit && accountsData.eventQueue !== undefined) {
        // initialize with last sequence number
        const { HEADER } = EVENT_QUEUE_LAYOUT
        const header = HEADER.decode(accountsData.eventQueue) as EventQueueHeader
        this._lastSeenSeqNum = header.seqNum
      }

      this._initialized = true

      yield this._putInEnvelope(l3Snapshot, isInit)
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

    const bookIsCrossed =
      newL2Snapshot.asks.length > 0 &&
      newL2Snapshot.bids.length > 0 &&
      // best bid price is >= best ask price
      Number(newL2Snapshot.bids[0]![0]) >= Number(newL2Snapshot.asks[0]![0])

    if (bookIsCrossed) {
      logger.log('warn', 'PartitionDetected: crossed L2 book', {
        market: this._options.symbol,
        quote: newQuote,
        slot
      })

      this._options.onPartitionDetected()

      return
    }

    const asksDiff =
      accountsData.asks !== undefined ? this._getL2Diff(this._currentL2Snapshot.asks, newL2Snapshot.asks) : []

    const bidsDiff =
      accountsData.bids !== undefined ? this._getL2Diff(this._currentL2Snapshot.bids, newL2Snapshot.bids) : []

    if (l3Diff.length > 0) {
      for (let i = 0; i < l3Diff.length; i++) {
        const message = l3Diff[i]!

        yield this._putInEnvelope(message, true)

        // detect l2 trades based on fills
        if (message.type === 'fill' && message.maker === false) {
          // this is rather fragile way of finding matching fill, can it be done better?

          const matchingMakerFill =
            l3Diff[i - 1] !== undefined && l3Diff[i - 1]!.type === 'fill'
              ? (l3Diff[i - 1] as Fill)
              : l3Diff[i - 2] !== undefined && l3Diff[i - 2]!.type === 'fill'
              ? (l3Diff[i - 2] as Fill)
              : undefined

          const makerFillOrderId =
            matchingMakerFill !== undefined &&
            matchingMakerFill.maker === true &&
            matchingMakerFill.size === message.size
              ? matchingMakerFill.orderId
              : '_'

          const tradeId = `${message.orderId}|${makerFillOrderId}`

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
      if (l3Diff.length === 0) {
        logger.log('warn', 'L2 diff without corresponding L3 diff', {
          market: this._options.symbol,
          asksAccountExists: accountsData.asks !== undefined,
          bidsAccountExists: accountsData.bids !== undefined,
          eventQueueAccountExists: accountsData.eventQueue !== undefined,
          slot,
          asksDiff,
          bidsDiff
        })
      }

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

  private _addChangedOrderItemsToL3Diff(
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

      const openMessage = this._mapToOrderMessage(newOrder, 'open', size, timestamp, slot)

      const matchingL3Index = l3Diff.findIndex((i) => i.orderId === newOrder.orderId)

      // insert open order before first matching l3 index if it exists
      if (matchingL3Index !== -1) {
        l3Diff.splice(matchingL3Index, 0, openMessage)
      } else {
        // if there's not matching fill/done l3 add open order at the end
        l3Diff.push(openMessage)
      }
    } else if (
      matchingExistingOrder.size !== newOrder.size &&
      l3Diff.some((i) => i.type === 'fill' && i.orderId === newOrder.orderId && i.maker) === false
    ) {
      // we have order change, can happen when  SelfTradeBehavior::DecrementTake?
      const changeMessage = this._mapToOrderMessage(newOrder, 'change', newOrder.size, timestamp, slot)

      const matchingL3Index = l3Diff.findIndex((i) => i.orderId === newOrder.orderId)

      // insert open order before first matching l3 index if it exists
      if (matchingL3Index !== -1) {
        l3Diff.splice(matchingL3Index, 0, changeMessage)
      } else {
        // if there's not matching fill/done l3 add open order at the end
        l3Diff.push(changeMessage)
      }
    }
  }

  public reset() {
    if (this._initialized === false) {
      return
    }

    this._initialized = false
    this._lastSeenSeqNum = undefined
    this._bidsAccountOrders = undefined
    this._asksAccountOrders = undefined
    this._localBidsOrdersMap = undefined
    this._localAsksOrdersMap = undefined
    this._currentL2Snapshot = undefined
    this._currentQuote = undefined
  }

  private _validateL3DiffCorrectness(l3Diff: (Open | Fill | Done | Change)[]) {
    // first make sure we have initial snapshots to apply diffs to

    if (this._localAsksOrdersMap === undefined && this._localBidsOrdersMap === undefined) {
      this._localAsksOrdersMap = new Map(this._asksAccountOrders!.map(this._toMapConstructorStructure))
      this._localBidsOrdersMap = new Map(this._bidsAccountOrders!.map(this._toMapConstructorStructure))

      return true
    }

    for (const item of l3Diff) {
      const ordersMap = (item.side === 'buy' ? this._localBidsOrdersMap : this._localAsksOrdersMap)!
      if (item.type === 'open') {
        ordersMap.set(item.orderId, {
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
        const matchingOrder = ordersMap.get(item.orderId)

        if (matchingOrder !== undefined) {
          ;(matchingOrder as any).size = (Number((matchingOrder as any).size) - Number(item.size)).toFixed(
            this._options.sizeDecimalPlaces
          )
        } else if (item.maker === true) {
          logger.log('warn', 'Maker fill without open message', {
            market: this._options.symbol,
            fill: item,
            slot: item.slot
          })

          return false
        }
      }

      if (item.type === 'change') {
        const matchingOrder = ordersMap.get(item.orderId)
        ;(matchingOrder as any).size = item.size
      }

      if (item.type === 'done') {
        if (item.reason === 'canceled') {
          const matchingOrder = ordersMap.get(item.orderId)
          if (matchingOrder !== undefined) {
            if (matchingOrder.size !== item.sizeRemaining) {
              logger.log('warn', 'Done(cancel) message with incorrect sizeRemaining', {
                market: this._options.symbol,
                doneMessage: item,
                matchingOrder,
                slot: item.slot,
                l3Diff
              })
            }
          }
        }

        ordersMap.delete(item.orderId)
      }
    }

    if (this._bidsAccountOrders!.length !== this._localBidsOrdersMap!.size) {
      return false
    }

    for (let bid of this._bidsAccountOrders!) {
      const matchingLocalBid = this._localBidsOrdersMap!.get(bid.orderId)
      if (
        matchingLocalBid === undefined ||
        matchingLocalBid.price !== bid.price ||
        matchingLocalBid.size !== bid.size
      ) {
        return false
      }
    }

    if (this._asksAccountOrders!.length !== this._localAsksOrdersMap!.size) {
      return false
    }

    for (let ask of this._asksAccountOrders!) {
      const matchingLocalAsk = this._localAsksOrdersMap!.get(ask.orderId)
      if (
        matchingLocalAsk === undefined ||
        matchingLocalAsk.price !== ask.price ||
        matchingLocalAsk.size !== ask.size
      ) {
        return false
      }
    }

    return true
  }

  // based on https://github.com/project-serum/serum-ts/blob/525786435d6893c1cc6a670b39a0ba575dd9cca6/packages/serum/src/market.ts#L1389
  private _mapToL2Snapshot(slabItems: SlabItem[]) {
    const levels: [BN, BN][] = []

    for (const { key, quantity } of slabItems) {
      const price = key.ushrn(64)

      if (levels.length > 0 && levels[levels.length - 1]![0].eq(price)) {
        levels[levels.length - 1]![1] = levels[levels.length - 1]![1].add(quantity)
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
    fillsIds: Map<string, Fill>
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
      // done means that there won't be any more messages for the order (is no longer in the order book or never was - canceled, ioc)

      let reason
      const localOpenOrders = side === 'buy' ? this._localBidsOrdersMap : this._localAsksOrdersMap

      if (fillsIds.has(orderId)) {
        if (localOpenOrders !== undefined && localOpenOrders.has(orderId)) {
          const matchingOpenOrder = localOpenOrders.get(orderId)!

          if (matchingOpenOrder.size !== fillsIds.get(orderId)!.size) {
            // open order was filled but only partially and it's done now meaning it was canceled after a fill
            reason = 'canceled' as const
          } else {
            // order was fully filled as open order size matches fill size
            reason = 'filled' as const
          }
        } else {
          // order was filled without matching open order meaning market order
          reason = 'filled' as const
        }
      } else {
        // no matching fill order means normal cancellation
        reason = 'canceled' as const
      }

      const doneMessage: Done = {
        type: 'done',
        market: this._options.symbol,
        timestamp,
        slot,
        version: this._version,
        orderId,
        clientId,
        side,
        reason,
        account: openOrdersAccount,
        accountSlot: openOrdersSlot,
        sizeRemaining:
          reason === 'canceled' ? this._getDoneSize(event).toFixed(this._options.sizeDecimalPlaces) : undefined
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

  private _getDoneSize(event: Event) {
    if (event.eventFlags.bid) {
      return this._options.market.baseSizeLotsToNumber(
        event.nativeQuantityReleased.div(
          event.orderId.ushrn(64).mul((this._options.market as any)._decoded.quoteLotSize)
        )
      )
    } else {
      return divideBnToNumber(event.nativeQuantityReleased, (this._options.market as any)._baseSplTokenMultiplier)
    }
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

      const newEventsCount = Math.min(header.seqNum - this._lastSeenSeqNum, allocLen - 1)

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
