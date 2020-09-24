import { EVENT_QUEUE_LAYOUT, Market, Orderbook, REQUEST_QUEUE_LAYOUT } from '@project-serum/serum'
import { Order } from '@project-serum/serum/lib/market'
import { Event } from '@project-serum/serum/lib/queue'
import BN from 'bn.js'
import { CancelOrderReceived, Done, EventQueueHeader, Fill, L3Snapshot, NewOrderReceived, OrderItem, OrderOpen, Request } from './types'

// Data mappers responsibility is to map DEX accounts data to L3 messages
export class RequestQueueDataMapper {
  // this is helper object that marks last seen request so we don't process the same requests over and over
  private _lastSeenRequestQueueHead: Request | undefined = undefined

  constructor(
    private readonly _symbol: string,
    private readonly _market: Market,
    private readonly _priceDecimalPlaces: number,
    private readonly _sizeDecimalPlaces: number
  ) {}

  public *map(requestQueueData: Buffer, slot: string, timestamp: number) {
    // we're interested only in newly added requests to queue since last update
    // each account update publishes 'snaphost' not 'delta' so we need to figure it out the delta on our own
    const { newlyAddedRequests, requestQueueHead } = this._getNewlyAddedRequests(requestQueueData, this._lastSeenRequestQueueHead)

    // assign last seen head to current queue head
    this._lastSeenRequestQueueHead = requestQueueHead

    for (const request of newlyAddedRequests) {
      yield this._mapRequestToReceivedMessage(request, timestamp, slot)
    }
  }

  private _mapRequestToReceivedMessage(request: Request, timestamp: number, slot: string) {
    const clientId = request.clientOrderId ? request.clientOrderId.toString() : undefined
    const side = request.requestFlags.bid ? 'buy' : 'sell'
    const orderId = request.orderId.toString()
    const openOrdersAccount = request.openOrders.toString()
    const openOrdersSlot = request.openOrdersSlot
    const feeTier = request.feeTier
    const price = this._market.priceLotsToNumber(request.orderId.ushrn(64)).toFixed(this._priceDecimalPlaces)

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
        price,
        reason: 'cancel',
        openOrders: openOrdersAccount,
        openOrdersSlot,
        feeTier
      }

      return cancelOrderReceived
    } else {
      const sequenceNumber = side === 'sell' ? request.orderId.maskn(64) : request.orderId.notn(128).maskn(64)

      const newOrderReceived: NewOrderReceived = {
        type: 'received',
        symbol: this._symbol,
        timestamp: timestamp,
        slot,
        orderId: orderId,
        clientId: clientId,
        side,
        sequence: sequenceNumber.toString(),
        price,
        size: this._market.baseSizeLotsToNumber(request.maxBaseSizeOrCancelId).toFixed(this._sizeDecimalPlaces),
        orderType: request.requestFlags.ioc ? 'ioc' : request.requestFlags.postOnly ? 'postOnly' : 'limit',
        reason: 'new',
        openOrders: openOrdersAccount,
        openOrdersSlot,
        feeTier
      }

      return newOrderReceived
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

      // stop when we've found item that was queue head for last update
      if (requestsEqual(lastSeenRequestQueueHead, request)) {
        break
      }

      // _decodeRequestQueue returns requests from newest to oldest
      // but we should return newly added requests from oldest to newest
      newlyAddedRequests.unshift(request)
    }

    return {
      requestQueueHead,
      newlyAddedRequests
    }
  }

  // modified version of https://github.com/project-serum/serum-js/blob/master/src/queue.ts#L87
  // that returns iterator instead of array
  private *_decodeRequestQueue(buffer: Buffer): IterableIterator<Request> {
    const { HEADER, NODE } = REQUEST_QUEUE_LAYOUT
    const header = HEADER.decode(buffer)

    const allocLen = Math.floor((buffer.length - HEADER.span) / NODE.span)

    for (let i = 0; i < allocLen; ++i) {
      const nodeIndex = (header.head + header.count + allocLen - 1 - i) % allocLen
      const decodedItem = NODE.decode(buffer, HEADER.span + nodeIndex * NODE.span)

      yield decodedItem
    }
  }
}

export class AsksBidsDataMapper {
  private _localAsks: Order[] | undefined = undefined
  private _localBids: Order[] | undefined = undefined
  private _initialized = false

  constructor(
    private readonly _symbol: string,
    private readonly _market: Market,
    private readonly _priceDecimalPlaces: number,
    private readonly _sizeDecimalPlaces: number
  ) {}

  public *map(asksAccountData: Buffer | undefined, bidsAccountData: Buffer | undefined, slot: string, timestamp: number) {
    // TODO: perhaps this can be more optimized to not allocate new Order array each time if too slow in practice
    if (asksAccountData !== undefined) {
      const newAsks = [...Orderbook.decode(this._market, asksAccountData)]
      if (this._initialized) {
        // find new ask orders since last update
        for (const ask of newAsks) {
          const isNewOrder = this._localAsks!.findIndex((f) => f.orderId.eq(ask.orderId)) === -1
          if (isNewOrder) {
            yield this._mapToOpenMessage(ask, timestamp, slot)
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
            yield this._mapToOpenMessage(bid, timestamp, slot)
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
        slot,
        asks: asksOrders,
        bids: bidsOrders
      }

      yield l3Snapshot
    }
  }

  private _mapToOpenMessage(order: Order, timestamp: number, slot: string): OrderOpen {
    return {
      type: 'open',
      symbol: this._symbol,
      timestamp,
      slot,
      orderId: order.orderId.toString(),
      clientId: order.clientId ? order.clientId.toString() : undefined,
      side: order.side,
      price: order.price.toFixed(this._priceDecimalPlaces),
      size: order.size.toFixed(this._sizeDecimalPlaces),
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
      price: order.price.toFixed(this._priceDecimalPlaces),
      size: order.size.toFixed(this._sizeDecimalPlaces),
      openOrders: order.openOrdersAddress.toString(),
      openOrdersSlot: order.openOrdersSlot,
      feeTier: order.feeTier
    }

    return orderItem
  }
}

export class EventQueueDataMapper {
  private _lastSeenSeqNum: number | undefined = undefined

  constructor(
    private readonly _symbol: string,
    private readonly _market: Market,
    private readonly _priceDecimalPlaces: number,
    private readonly _sizeDecimalPlaces: number
  ) {}

  public *map(eventQueueData: Buffer, slot: string, timestamp: number) {
    // we're interested only in newly added events since last update
    // each account update publishes 'snaphost' not 'delta' so we need to figure it out the delta on our own

    let fillsIds: string[] = []
    for (const event of this._getNewlyAddedEvents(eventQueueData)) {
      const message = this._mapEventToDataMessage(event, timestamp, slot, fillsIds)
      if (message === undefined) {
        continue
      }
      if (message.type === 'fill') {
        fillsIds.push(message.orderId)
      }

      yield message
    }
  }

  private _mapEventToDataMessage(event: Event, timestamp: number, slot: string, fillsIds: string[]): Fill | Done | undefined {
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
        price: this._getFillPrice(event).toFixed(this._priceDecimalPlaces),
        size: this._getFillSize(event).toFixed(this._sizeDecimalPlaces),
        maker: event.eventFlags.maker,
        feeCost: this._market.quoteSplSizeToNumber(event.nativeFeeOrRebate) * (event.eventFlags.maker ? -1 : 1),
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

    return
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

// copy of https://github.com/project-serum/serum-js/blob/master/src/market.ts#L1325
// ideally serum.js should export it
function divideBnToNumber(numerator: BN, denominator: BN): number {
  const quotient = numerator.div(denominator).toNumber()
  const rem = numerator.umod(denominator)
  const gcd = rem.gcd(denominator)
  return quotient + rem.div(gcd).toNumber() / denominator.div(gcd).toNumber()
}
