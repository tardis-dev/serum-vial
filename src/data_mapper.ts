import { EVENT_QUEUE_LAYOUT, Market, Orderbook } from '@project-serum/serum'
import { Order } from '@project-serum/serum/lib/market'
import { Event } from '@project-serum/serum/lib/queue'
import BN from 'bn.js'
import { logger } from './logger'
import { AccountsData, MessageEnvelope } from './serum_producer'
import { Change, DataMessage, Done, EventQueueHeader, Fill, L3Snapshot, OrderItem, Open } from './types'

// DataMapper maps bids, asks and evenQueue accounts data to normalized messages
export class DataMapper {
  private _bidsAccountOrders: OrderItem[] | undefined = undefined
  private _asksAccountOrders: OrderItem[] | undefined = undefined
  private _localBidsOrders: OrderItem[] | undefined = undefined
  private _localAsksOrders: OrderItem[] | undefined = undefined
  private _initialized = false
  private _lastSeenSeqNum: number | undefined = undefined

  private readonly _marketAddress: string

  constructor(
    private readonly _options: {
      readonly symbol: string
      readonly market: Market
      readonly priceDecimalPlaces: number
      readonly sizeDecimalPlaces: number
      readonly testMode: boolean
    }
  ) {
    this._marketAddress = this._options.market.address.toString()
  }

  public *map(accountsData: AccountsData, slot: string, restarted: boolean): IterableIterator<MessageEnvelope> {
    // the same timestamp for all messages received in single notification
    const timestamp = new Date().toISOString()

    // if subscription was restarted, reset everything and re-init from scratch
    if (restarted) {
      this._reset()
    }

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
      const newAsksSnapshot = [...Orderbook.decode(this._options.market, accountsData.asks).items(false)].map(
        this._mapToOrderItem
      )

      if (this._initialized) {
        for (const ask of newAsksSnapshot) {
          const message = this._mapNewOrderToMessage(this._asksAccountOrders!, ask, timestamp, slot, l3Diff)
          if (message !== undefined) {
            // unshift as open/change messages should be processed before fill/done
            l3Diff.unshift(message)
          }
        }
      }

      this._asksAccountOrders = newAsksSnapshot
    }

    if (accountsData.bids !== undefined) {
      const newBidsSnapshot = [...Orderbook.decode(this._options.market, accountsData.bids).items(true)].map(
        this._mapToOrderItem
      )

      if (this._initialized) {
        for (const bid of newBidsSnapshot) {
          const message = this._mapNewOrderToMessage(this._bidsAccountOrders!, bid, timestamp, slot, l3Diff)
          if (message !== undefined) {
            // unshift as open/change messages should be processed before fill/done
            l3Diff.unshift(message)
          }
        }
      }

      this._bidsAccountOrders = newBidsSnapshot
    }

    if (this._options.testMode && this._initialized && l3Diff.length > 0) {
      this._validateL3DiffCorrectness(l3Diff)
    }

    if (this._asksAccountOrders !== undefined && this._bidsAccountOrders !== undefined) {
      const l3Snapshot: L3Snapshot = {
        type: 'l3snapshot',
        symbol: this._options.symbol,
        timestamp,
        slot,
        market: this._marketAddress,
        asks: this._asksAccountOrders,
        bids: this._bidsAccountOrders
      }

      if (this._options.testMode && this._initialized === true) {
        ;(l3Snapshot as any).testMode = true
      }

      const publish = this._options.testMode || this._initialized === false
      this._initialized = true

      yield this._putInEnvelope(l3Snapshot, publish)
    }

    for (const message of l3Diff) {
      yield this._putInEnvelope(message, true)
    }
  }

  private _mapNewOrderToMessage(
    existingOrders: OrderItem[],
    newOrder: OrderItem,
    timestamp: string,
    slot: string,
    l3Diff: (Open | Fill | Done | Change)[]
  ) {
    const matchingExistingOrder = existingOrders.find((o) => o.orderId === newOrder.orderId)

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

  private _reset() {
    this._initialized = false
    this._lastSeenSeqNum = undefined
    this._bidsAccountOrders = undefined
    this._asksAccountOrders = undefined
    this._localBidsOrders = undefined
    this._localAsksOrders = undefined
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
      this._reset()
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
        this._reset()
        return
      }
    }

    if (this._asksAccountOrders!.length !== this._localAsksOrders!.length) {
      logger.log('error', 'Invalid asks diff', {
        l3Diff,
        asksAccountOrders: this._asksAccountOrders,
        localAsksOrders: this._localAsksOrders
      })
      this._reset()
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

        this._reset()

        return
      }
    }
  }

  private _putInEnvelope(message: DataMessage, publish: boolean) {
    const envelope: MessageEnvelope = {
      type: message.type,
      symbol: message.symbol,
      publish,
      payload: JSON.stringify(message),
      timestamp: message.timestamp
    }

    return envelope
  }

  private _mapEventToDataMessage(
    event: Event,
    timestamp: string,
    slot: string,
    fillsIds: string[]
  ): Fill | Done | Change | undefined {
    const clientId = (event as any).clientOrderId ? (event as any).clientOrderId.toString() : undefined

    const side = event.eventFlags.bid ? 'buy' : 'sell'
    const orderId = event.orderId.toString()
    const openOrdersAccount = event.openOrders.toString()
    const openOrdersSlot = event.openOrdersSlot
    const feeTier = event.feeTier

    if (event.eventFlags.fill) {
      const fillMessage: Fill = {
        type: 'fill',
        symbol: this._options.symbol,
        timestamp,
        slot,
        market: this._marketAddress,
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
        symbol: this._options.symbol,
        timestamp,
        slot,
        market: this._marketAddress,
        orderId,
        clientId,
        side,
        reason: fillsIds.includes(orderId) ? 'filled' : 'canceled',
        account: openOrdersAccount,
        accountSlot: openOrdersSlot,
        feeTier: feeTier
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
    { orderId, clientId, side, price, account: openOrders, accountSlot: openOrdersSlot, feeTier }: OrderItem,
    type: 'open' | 'change',
    size: string,
    timestamp: string,
    slot: string
  ): Open | Change {
    return {
      type,
      symbol: this._options.symbol,
      timestamp,
      slot,
      market: this._marketAddress,
      orderId,
      clientId,
      side,
      price,
      size,
      account: openOrders,
      accountSlot: openOrdersSlot,
      feeTier
    }
  }

  private _mapToOrderItem = (order: Order) => {
    const orderItem: OrderItem = {
      orderId: order.orderId.toString(),
      clientId: order.clientId ? order.clientId.toString() : undefined,
      side: order.side,
      price: order.price.toFixed(this._options.priceDecimalPlaces),
      size: order.size.toFixed(this._options.sizeDecimalPlaces),
      account: order.openOrdersAddress.toString(),
      accountSlot: order.openOrdersSlot,
      feeTier: order.feeTier
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
