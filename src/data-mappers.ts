import { decodeRequestQueue, Market } from '@project-serum/serum'
import { Context } from '@solana/web3.js'
import { ReceivedCancelOrder, ReceivedNewOrder, RequestQueueItem } from './types'

export class RequestQueueDataMapper {
  // this is helper object that marks last seen request item so we don't process the same items over and over
  private _lastSeenRequestQueueHead: RequestQueueItem | undefined = undefined

  constructor(private readonly _marketSymbol: string, private readonly _market: Market) {}

  public *map(requestQueueData: Buffer, context: Context, timestamp: Date) {
    const { newlyAddedRequestQueueItems, requestQueueHead } = this._getNewlyAddedRequestQueueItems(
      requestQueueData,
      this._lastSeenRequestQueueHead
    )

    // assign last seen head to current queue head
    this._lastSeenRequestQueueHead = requestQueueHead

    for (let newRequestQueueItem of newlyAddedRequestQueueItems) {
      yield this._mapRequestItemToReceiveMessage(newRequestQueueItem, timestamp, context.slot)
    }
  }

  private _mapRequestItemToReceiveMessage(item: RequestQueueItem, timestamp: Date, slot: number) {
    const clientId = item.clientOrderId ? item.clientOrderId.toString() : undefined
    const side = item.requestFlags.bid ? 'buy' : 'sell'
    const orderId = item.orderId.toString()
    const openOrdersAccount = item.openOrders.toString()

    if (item.requestFlags.cancelOrder) {
      const cancelMessage: ReceivedCancelOrder = {
        type: 'received',
        symbol: this._marketSymbol,
        timestamp,
        orderId,
        side,
        reason: 'cancel',
        feeTier: item.feeTier,
        openOrdersSlot: item.openOrdersSlot,
        clientId,
        slot,
        openOrdersAccount
      }

      return cancelMessage
    } else {
      const newOrderMessage: ReceivedNewOrder = {
        type: 'received',
        symbol: this._marketSymbol,
        timestamp,
        orderId,
        side,
        reason: 'new',
        orderType: item.requestFlags.ioc ? 'ioc' : item.requestFlags.postOnly ? 'postOnly' : 'limit',
        price: this._market.priceLotsToNumber(item.orderId.ushrn(64)),
        size: this._market.baseSizeLotsToNumber(item.maxBaseSizeOrCancelId),
        feeTier: item.feeTier,
        openOrdersSlot: item.openOrdersSlot,
        clientId,
        slot,
        openOrdersAccount
      }

      return newOrderMessage
    }
  }

  private _getNewlyAddedRequestQueueItems(requestQueueData: Buffer, lastSeenRequestQueueHead: RequestQueueItem | undefined) {
    // TODO: is there a better way to process only new items since last update?

    const queue = this._decodeRequestQueue(requestQueueData)
    let requestQueueHead: RequestQueueItem | undefined = undefined
    let newlyAddedRequestQueueItems: RequestQueueItem[] = []

    for (let requestQueueItem of queue) {
      // set new queue head to temp variable
      if (requestQueueHead === undefined) {
        requestQueueHead = requestQueueItem
      }
      // not yet initialized, do not process remaining queue items
      if (lastSeenRequestQueueHead === undefined) {
        break
      }

      if (requestItemsEqual(lastSeenRequestQueueHead, requestQueueItem)) {
        break
      }

      // quee returns items from newest to oldest, we should publish messages from oldest from newest
      newlyAddedRequestQueueItems.unshift(requestQueueItem)
    }

    return {
      requestQueueHead,
      newlyAddedRequestQueueItems
    }
  }

  private *_decodeRequestQueue(data: Buffer): IterableIterator<RequestQueueItem> {
    // TODO: this is far from ideal workaround for serum.js not providing iterator over request queue
    // but essentially we don't want to decode full queue if not needed
    // TODO: open issue in serum.js to support it natively without that ugly hack?
    let peek = decodeRequestQueue(data, 1)
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

function requestItemsEqual(item1: RequestQueueItem, item2: RequestQueueItem) {
  if (item1.orderId.eq(item2.orderId) === false) {
    return false
  }

  if (item1.openOrdersSlot !== item2.openOrdersSlot) {
    return false
  }

  if (item1.maxBaseSizeOrCancelId.eq(item2.maxBaseSizeOrCancelId) === false) {
    return false
  }

  if (item1.nativeQuoteQuantityLocked.eq(item2.nativeQuoteQuantityLocked) === false) {
    return false
  }

  if (item1.openOrders.equals(item2.openOrders) === false) {
    return false
  }

  if (item1.requestFlags.bid !== item2.requestFlags.bid) {
    return false
  }
  if (item1.requestFlags.cancelOrder !== item2.requestFlags.cancelOrder) {
    return false
  }
  if (item1.requestFlags.ioc !== item2.requestFlags.ioc) {
    return false
  }

  if (item1.requestFlags.newOrder !== item2.requestFlags.newOrder) {
    return false
  }

  if (item1.requestFlags.postOnly !== item2.requestFlags.postOnly) {
    return false
  }

  return true
}
