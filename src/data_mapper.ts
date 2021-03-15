import { EVENT_QUEUE_LAYOUT, Market, Orderbook } from '@project-serum/serum'
import { Order } from '@project-serum/serum/lib/market'
import { Event } from '@project-serum/serum/lib/queue'
import BN from 'bn.js'
import { AccountsData, MessageEnvelope } from './serum_producer'
import { DataMessage, Done, EventQueueHeader, Fill, L3Snapshot, OrderItem, OrderOpen } from './types'

// maps account data to normalized messages
export class DataMapper {
  private _bidsAccountOrders: Order[] | undefined = undefined
  private _asksAccountOrders: Order[] | undefined = undefined

  public initialized = false
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
    const timestamp = new Date().valueOf()

    // if subscription was restarted, re-initialize everything from scratch
    if (restarted) {
      this.initialized = false
    }

    if (accountsData.asks !== undefined) {
      const newAsksAccountOrders = [...Orderbook.decode(this._options.market, accountsData.asks).items(false)]

      if (this.initialized) {
        // find new ask orders since last update
        for (const ask of newAsksAccountOrders) {
          const isNewOrder = this._asksAccountOrders!.findIndex((f) => f.orderId.eq(ask.orderId)) === -1
          if (isNewOrder) {
            const openMessage = this._mapToOpenMessage(ask, timestamp, slot)
            yield this._putInEnvelope(openMessage, true)
          }
        }
      }

      this._asksAccountOrders = newAsksAccountOrders
    }

    if (accountsData.bids !== undefined) {
      const newBidsAccountOrders = [...Orderbook.decode(this._options.market, accountsData.bids).items(true)]

      if (this.initialized) {
        // find new bid orders since last update
        for (const bid of newBidsAccountOrders) {
          const isNewOrder = this._bidsAccountOrders!.findIndex((f) => f.orderId.eq(bid.orderId)) === -1
          if (isNewOrder) {
            const openMessage = this._mapToOpenMessage(bid, timestamp, slot)
            yield this._putInEnvelope(openMessage, true)
          }
        }
      }

      this._bidsAccountOrders = newBidsAccountOrders
    }

    if (this._asksAccountOrders !== undefined && this._bidsAccountOrders !== undefined) {
      const asksOrders = this._asksAccountOrders!.map(this._mapToOrderItem)
      const bidsOrders = this._bidsAccountOrders!.map(this._mapToOrderItem)

      const l3Snapshot: L3Snapshot = {
        type: 'l3snapshot',
        symbol: this._options.symbol,
        timestamp,
        slot,
        market: this._marketAddress,
        asks: asksOrders,
        bids: bidsOrders
      }

      const publish = this._options.testMode || this.initialized === false
      this.initialized = true

      yield this._putInEnvelope(l3Snapshot, publish)
    }

    // we're interested only in newly added events since last update
    // each account update publishes 'snaphost' not 'delta' so we need to figure it out the delta on our own
    if (this.initialized && accountsData.eventQueue !== undefined) {
      let fillsIds: string[] = []
      for (const event of this._getNewlyAddedEvents(accountsData.eventQueue)) {
        const message = this._mapEventToDataMessage(event, timestamp, slot, fillsIds)
        if (message === undefined) {
          continue
        }
        if (message.type === 'fill') {
          fillsIds.push(message.orderId)
        }

        yield this._putInEnvelope(message, true)
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
    timestamp: number,
    slot: string,
    fillsIds: string[]
  ): Fill | Done | undefined {
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
        openOrders: openOrdersAccount,
        openOrdersSlot: openOrdersSlot,
        feeTier: feeTier
      }

      return fillMessage
    } else if (event.nativeQuantityPaid.eqn(0)) {
      // we can use nativeQuantityStillLocked === 0 to detect if order is 'done'
      // this is what the dex uses at event processing time to decide if it can release the slot in an OpenOrders account.
      // done means that there won't be any more messages for the order (is no longer in the order book or never was - cancelled, ioc)

      // for 'out' events:
      // - nativeQuantityPaid = nativeQuantityStillLocked
      // - nativeQuantityReleased = nativeQuantityUnlocked

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
        openOrders: openOrdersAccount,
        openOrdersSlot: openOrdersSlot,
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
    const nativeQuantity = event.eventFlags.bid ? event.nativeQuantityPaid : event.nativeQuantityReleased

    const priceBeforeFees = event.eventFlags.maker
      ? nativeQuantity.sub(event.nativeFeeOrRebate)
      : nativeQuantity.add(event.nativeFeeOrRebate)

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
        const nodeIndex = (header.head + header.count - i) % allocLen
        const decodedItem = NODE.decode(eventQueueData, HEADER.span + nodeIndex * NODE.span) as Event

        yield decodedItem
      }
    }

    this._lastSeenSeqNum = header.seqNum
  }

  private _mapToOpenMessage(order: Order, timestamp: number, slot: string): OrderOpen {
    return {
      type: 'open',
      symbol: this._options.symbol,
      timestamp,
      slot,
      market: this._marketAddress,
      orderId: order.orderId.toString(),
      clientId: order.clientId ? order.clientId.toString() : undefined,
      side: order.side,
      price: order.price.toFixed(this._options.priceDecimalPlaces),
      size: order.size.toFixed(this._options.sizeDecimalPlaces),
      openOrders: order.openOrdersAddress.toString(),
      openOrdersSlot: order.openOrdersSlot,
      feeTier: order.feeTier
    }
  }

  private _mapToOrderItem = (order: Order) => {
    const orderItem: OrderItem = {
      orderId: order.orderId.toString(),
      clientId: order.clientId ? order.clientId.toString() : undefined,
      side: order.side,
      price: order.price.toFixed(this._options.priceDecimalPlaces),
      size: order.size.toFixed(this._options.sizeDecimalPlaces),
      openOrders: order.openOrdersAddress.toString(),
      openOrdersSlot: order.openOrdersSlot,
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
