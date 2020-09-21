import { decodeRequestQueue, Market, Orderbook } from '@project-serum/serum'
import { Order } from '@project-serum/serum/lib/market'
import { decodeEventQueue, Event } from '@project-serum/serum/lib/queue'
import { Context } from '@solana/web3.js'
import BN from 'bn.js'
import { CancelOrderReceived, Done, Fill, L3Snapshot, OrderItem, OrderOpen, PlaceOrderReceived, Request } from './types'

// Data mappers responsibility is to map DEX accounts data to L3 messages
export class RequestQueueDataMapper {
  // this is helper object that marks last seen request so we don't process the same requests over and over
  private _lastSeenRequestQueueHead: Request | undefined = undefined

  constructor(private readonly _symbol: string, private readonly _market: Market) {}

  public *map(requestQueueData: Buffer, context: Context, timestamp: number) {
    // we're interested only in newly added requests to queue since last update
    // each account update publishes 'snaphost' not 'delta' so we need to figure it out the delta on our own
    const { newlyAddedRequests, requestQueueHead } = this._getNewlyAddedRequests(requestQueueData, this._lastSeenRequestQueueHead)

    // assign last seen head to current queue head
    this._lastSeenRequestQueueHead = requestQueueHead

    for (const request of newlyAddedRequests) {
      yield this._mapRequestToReceivedMessage(request, timestamp, context.slot)
    }
  }

  private _mapRequestToReceivedMessage(request: Request, timestamp: number, slot: number) {
    const clientId = request.clientOrderId ? request.clientOrderId.toString() : undefined
    const side = request.requestFlags.bid ? 'buy' : 'sell'
    const orderId = request.orderId.toString()
    const openOrdersAccount = request.openOrders.toString()
    const openOrdersSlot = request.openOrdersSlot
    const feeTier = request.feeTier

    if (request.requestFlags.cancelOrder) {
      const cancelOrderReceived: CancelOrderReceived = {
        type: 'received',
        symbol: this._symbol,
        timestamp: timestamp,
        slot,
        orderId: orderId,
        clientId: clientId,
        side,
        sequence: request.maxBaseSizeOrCancelId.toString(),
        reason: 'cancel',
        openOrders: openOrdersAccount,
        openOrdersSlot,
        feeTier
      }

      return cancelOrderReceived
    } else {
      const sequenceNumber = side === 'sell' ? request.orderId.maskn(64) : request.orderId.notn(128).maskn(64)

      const placeOrderReceived: PlaceOrderReceived = {
        type: 'received',
        symbol: this._symbol,
        timestamp: timestamp,
        slot,
        orderId: orderId,
        clientId: clientId,
        side,
        sequence: sequenceNumber.toString(),
        price: this._market.priceLotsToNumber(request.orderId.ushrn(64)),
        size: this._market.baseSizeLotsToNumber(request.maxBaseSizeOrCancelId),
        orderType: request.requestFlags.ioc ? 'ioc' : request.requestFlags.postOnly ? 'postOnly' : 'limit',
        reason: 'place',
        openOrders: openOrdersAccount,
        openOrdersSlot,
        feeTier
      }

      return placeOrderReceived
    }
  }

  private _getNewlyAddedRequests(requestQueueData: Buffer, lastSeenRequestQueueHead: Request | undefined) {
    const queue = this._decodeRequestQueue(requestQueueData)
    let requestQueueHead: Request | undefined = undefined
    const newlyAddedRequests: Request[] = []

    for (const request of queue) {
      // set new queue head to temp variable
      if (requestQueueHead === undefined) {
        requestQueueHead = request
      }
      // not yet initialized, do not process remaining queue items
      if (lastSeenRequestQueueHead === undefined) {
        break
      }

      if (requestsEqual(lastSeenRequestQueueHead, request)) {
        break
      }

      // _decodeRequestQueue returns requests from newest to oldest, we should publish messages from oldest from newest
      newlyAddedRequests.unshift(request)
    }

    return {
      requestQueueHead,
      newlyAddedRequests
    }
  }

  private *_decodeRequestQueue(data: Buffer): IterableIterator<Request> {
    // TODO: this is far from ideal workaround for serum.js not providing iterator over request queue
    // but essentially we don't want to decode full queue if not needed
    // TODO: open issue in serum.js to support it natively without that ugly hack?
    const peek = decodeRequestQueue(data, 1)
    if (peek.length === 0) {
      return
    }

    yield peek[0]

    const smallDecode = decodeRequestQueue(data, 10)
    for (let i = 1; i < smallDecode.length; i++) {
      yield smallDecode[i]
    }

    if (smallDecode.length === 10) {
      const largeDecode = decodeRequestQueue(data, 200)
      for (let i = 10; i < largeDecode.length; i++) {
        yield largeDecode[i]
      }
      if (largeDecode.length === 200) {
        const largestDecode = decodeRequestQueue(data, 20000)
        for (let i = 200; i < largestDecode.length; i++) {
          yield largestDecode[i]
        }
      }
    }
  }
}

export class AsksBidsDataMapper {
  private _localAsks: Order[] | undefined = undefined
  private _localBids: Order[] | undefined = undefined
  private _initialized = false

  constructor(private readonly _symbol: string, private readonly _market: Market) {}

  public *map(asksAccountData: Buffer | undefined, bidsAccountData: Buffer | undefined, context: Context, timestamp: number) {
    // TODO: perhaps this can be more optimized to not allocate new Order array each time if too slow in practice
    if (asksAccountData !== undefined) {
      const newAsks = [...Orderbook.decode(this._market, asksAccountData)]
      if (this._initialized) {
        // find new ask orders since last update
        for (const ask of newAsks) {
          const isNewOrder = this._localAsks!.findIndex((f) => f.orderId.eq(ask.orderId)) === -1
          if (isNewOrder) {
            yield this._mapToOpenMessage(ask, timestamp, context.slot)
          }
        }
      }

      this._localAsks = newAsks
    }

    if (bidsAccountData !== undefined) {
      const newBids = [...Orderbook.decode(this._market, bidsAccountData)]
      if (this._initialized) {
        // find new bid orders since last update
        for (const bid of newBids) {
          const isNewOrder = this._localBids!.findIndex((f) => f.orderId.eq(bid.orderId)) === -1
          if (isNewOrder) {
            yield this._mapToOpenMessage(bid, timestamp, context.slot)
          }
        }
      }

      this._localBids = newBids
    }

    if (this._initialized === false && this._localAsks !== undefined && this._localBids !== undefined) {
      this._initialized = true
      // return full l3 snapshot on init
      const asksOrders = this._localAsks.map(this._mapToOrderItem)
      const bidsOrders = this._localBids.map(this._mapToOrderItem)

      const l3Snapshot: L3Snapshot = {
        type: 'l3snapshot',
        symbol: this._symbol,
        timestamp,
        slot: context.slot,
        orders: [...asksOrders, ...bidsOrders]
      }

      yield l3Snapshot
    }
  }

  private _mapToOpenMessage(order: Order, timestamp: number, slot: number): OrderOpen {
    return {
      type: 'open',
      symbol: this._symbol,
      timestamp,
      slot,
      orderId: order.orderId.toString(),
      clientId: order.clientId ? order.clientId.toString() : undefined,
      side: order.side,
      price: order.price,
      size: order.size,
      openOrders: order.openOrdersAddress.toString(),
      openOrdersSlot: order.openOrdersSlot,
      feeTier: order.feeTier
    }
  }

  private _mapToOrderItem(order: Order): OrderItem {
    return {
      orderId: order.orderId.toString(),
      clientId: order.clientId ? order.clientId.toString() : undefined,
      side: order.side,
      price: order.price,
      size: order.size,
      openOrders: order.openOrdersAddress.toString(),
      openOrdersSlot: order.openOrdersSlot,
      feeTier: order.feeTier
    }
  }
}

export class EventQueueDataMapper {
  // this is helper object that marks last seen event so we don't process the same events over and over
  private _lastSeenEventQueueHead: Event | undefined = undefined

  constructor(private readonly _symbol: string, private readonly _market: Market) {}

  public *map(eventQueueData: Buffer, context: Context, timestamp: number) {
    // we're interested only in newly added events since last update
    // each account update publishes 'snaphost' not 'delta' so we need to figure it out the delta on our own
    const { newlyAddedEvents, eventQueueHead } = this._getNewlyAddedEvents(eventQueueData, this._lastSeenEventQueueHead)

    // assign last seen head to current queue head
    this._lastSeenEventQueueHead = eventQueueHead
    let fillsIds: string[] = []

    for (const event of newlyAddedEvents) {
      const message = this._mapEventToDataMessage(event, timestamp, context.slot, fillsIds)
      if (message.type === 'fill') {
        fillsIds.push(message.orderId)
      }
      yield message
    }
  }

  private _mapEventToDataMessage(event: Event, timestamp: number, slot: number, fillsIds: string[]): Fill | Done {
    const clientId = (event as any).clientOrderId ? (event as any).clientOrderId.toString() : undefined
    const side = event.eventFlags.bid ? 'buy' : 'sell'
    const orderId = event.orderId.toString()
    const openOrdersAccount = event.openOrders.toString()
    const openOrdersSlot = event.openOrdersSlot
    const feeTier = event.feeTier

    if (event.eventFlags.fill) {
      const fillMessage: Fill = {
        type: 'fill',
        symbol: this._symbol,
        timestamp,
        slot,
        orderId,
        clientId,
        side,
        price: this._getFillPrice(event),
        size: this._getFillSize(event),
        maker: event.eventFlags.maker,
        feeCost: this._market.quoteSplSizeToNumber(event.nativeFeeOrRebate) * (event.eventFlags.maker ? -1 : 1),
        openOrders: openOrdersAccount,
        openOrdersSlot: openOrdersSlot,
        feeTier: feeTier
      }

      return fillMessage
    } else {
      // order is done, there won't be any more messages for it
      // it means order is no longer in the order book or was immediately filled
      const doneMessage: Done = {
        type: 'done',
        symbol: this._symbol,
        timestamp,
        slot,
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
  }

  private _getFillSize(event: Event) {
    return divideBnToNumber(
      event.eventFlags.bid ? event.nativeQuantityReleased : event.nativeQuantityPaid,
      (this._market as any)._baseSplTokenMultiplier
    )
  }

  private _getFillPrice(event: Event) {
    const nativeQuantity = event.eventFlags.bid ? event.nativeQuantityPaid : event.nativeQuantityReleased

    const priceBeforeFees = event.eventFlags.maker
      ? nativeQuantity.sub(event.nativeFeeOrRebate)
      : nativeQuantity.add(event.nativeFeeOrRebate)

    const price = divideBnToNumber(
      priceBeforeFees.mul((this._market as any)._baseSplTokenMultiplier),
      (this._market as any)._quoteSplTokenMultiplier.mul(event.eventFlags.bid ? event.nativeQuantityReleased : event.nativeQuantityPaid)
    )

    return price
  }

  private _getNewlyAddedEvents(eventQueueData: Buffer, lastSeenEventQueueHead: Event | undefined) {
    // TODO: is there a better way to process only new events since last update
    // as currently we're remembering last update queue head item and compare to that

    const queue = this._decodeEventQueue(eventQueueData)
    let eventQueueHead: Event | undefined = undefined
    const newlyAddedEvents: Event[] = []

    for (const event of queue) {
      // set new queue head to temp variable
      if (eventQueueHead === undefined) {
        eventQueueHead = event
      }
      // not yet initialized, do not process remaining queue items
      if (lastSeenEventQueueHead === undefined) {
        break
      }

      if (eventsEqual(lastSeenEventQueueHead, event)) {
        break
      }

      // queue returns events from newest to oldest, we should publish messages from oldest from newest
      newlyAddedEvents.unshift(event)
    }

    return {
      eventQueueHead,
      newlyAddedEvents
    }
  }

  private *_decodeEventQueue(data: Buffer): IterableIterator<Event> {
    // TODO: this is far from ideal workaround for serum.js not providing iterator over event queue
    // but essentially we don't want to decode full queue if not needed

    const peek = decodeEventQueue(data, 1)
    if (peek.length === 0) {
      return
    }

    yield peek[0]

    const smallDecode = decodeEventQueue(data, 10)
    for (let i = 1; i < smallDecode.length; i++) {
      yield smallDecode[i]
    }

    if (smallDecode.length === 10) {
      const largeDecode = decodeEventQueue(data, 200)
      for (let i = 10; i < largeDecode.length; i++) {
        yield largeDecode[i]
      }

      if (largeDecode.length === 200) {
        const largestDecode = decodeEventQueue(data, 2000)
        for (let i = 200; i < largestDecode.length; i++) {
          yield largestDecode[i]
        }

        if (largestDecode.length === 2000) {
          let ultimateDecode = decodeEventQueue(data, 100000)
          for (let i = 2000; i < ultimateDecode.length; i++) {
            yield ultimateDecode[i]
          }
        }
      }
    }
  }
}

function requestsEqual(request1: Request, request2: Request) {
  if (request1.requestFlags.cancelOrder !== request2.requestFlags.cancelOrder) {
    return false
  }

  if (request1.requestFlags.cancelOrder === true) {
    // for cancel orders compare by cancel id (seq number), it's the same order if has the same cancel id
    return request1.maxBaseSizeOrCancelId.eq(request2.maxBaseSizeOrCancelId)
  } else {
    // for new orders compare by oder id as order id includes seq number
    return request1.orderId.eq(request2.orderId)
  }
}

function eventsEqual(event1: Event, event2: Event) {
  if (event1.orderId.eq(event2.orderId) === false) {
    return false
  }

  if (event1.openOrdersSlot !== event2.openOrdersSlot) {
    return false
  }

  if (event1.openOrders.equals(event2.openOrders) === false) {
    return false
  }
  if (event1.nativeQuantityReleased.eq(event2.nativeQuantityReleased) === false) {
    return false
  }

  if (event1.nativeQuantityPaid.eq(event2.nativeQuantityPaid) === false) {
    return false
  }
  if (event1.nativeFeeOrRebate.eq(event2.nativeFeeOrRebate) === false) {
    return false
  }
  if (event1.feeTier !== event2.feeTier) {
    return false
  }
  if (event1.eventFlags.bid !== event2.eventFlags.bid) {
    return false
  }

  if (event1.eventFlags.fill !== event2.eventFlags.fill) {
    return false
  }

  if (event1.eventFlags.maker !== event2.eventFlags.maker) {
    return false
  }

  if (event1.eventFlags.out !== event2.eventFlags.out) {
    return false
  }

  return true
}

// copy of https://github.com/project-serum/serum-js/blob/master/src/market.ts#L1325
// ideally serum.js should export it
function divideBnToNumber(numerator: BN, denominator: BN): number {
  const quotient = numerator.div(denominator).toNumber()
  const rem = numerator.umod(denominator)
  const gcd = rem.gcd(denominator)
  return quotient + rem.div(gcd).toNumber() / denominator.div(gcd).toNumber()
}
