import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { Op, Channel, MessageType } from './consts'

export type AccountName = 'bids' | 'asks' | 'requestQueue' | 'eventQueue'
export type AccountsData = { [key in AccountName]: Buffer | undefined }

export type RequestQueueItem = {
  requestFlags: {
    newOrder: boolean
    cancelOrder: boolean
    bid: boolean
    postOnly: boolean
    ioc: boolean
  }

  openOrdersSlot: number
  feeTier: number
  maxBaseSizeOrCancelId: BN
  nativeQuoteQuantityLocked: BN
  orderId: BN
  openOrders: PublicKey
  clientOrderId?: BN
}

export type SubRequest = {
  readonly op: Op
  readonly channel: Channel
  readonly markets: string[]
}

export interface Message {
  readonly type: MessageType
  readonly timestamp: Date
}

export interface DataMessage extends Message {
  readonly symbol: string
  readonly slot: number
}

export interface ErrorResponse extends Message {
  readonly type: 'error'
  readonly message: string
}

export interface SuccessResponse extends Message {
  readonly type: 'subscribed' | 'unsubscribed'
  readonly channel: Channel
  readonly markets: string[]
}

export type PriceLevel = [number, number]

export interface L2 extends DataMessage {
  readonly type: 'l2update' | 'l2snapshot'
  readonly asks: PriceLevel[]
  readonly bids: PriceLevel[]
}

export interface Quote extends DataMessage {
  readonly type: 'quote'
  readonly bestAsk: PriceLevel | undefined
  readonly bestBid: PriceLevel | undefined
}

export interface Trade extends DataMessage {
  readonly type: 'trade'
  readonly price: number
  readonly size: number
  readonly side: 'buy' | 'sell' // liquidity taker side
  readonly id: string
}

type OrderMeta = {
  id: string
  accountId: string
  clientId?: string
}

// TODO: review and finish remaining types
export interface Fill extends DataMessage {
  readonly type: 'fill'
  readonly price: number
  readonly size: number
  readonly side: 'buy' | 'sell' // liquidity taker side
  readonly id: string
  readonly makerOrder: OrderMeta
  readonly takerOrder: OrderMeta
}

export interface Received extends DataMessage {
  readonly type: 'received'
  readonly reason: 'new' | 'cancel' // TODO: is this a good field name for those values?
  readonly side: 'buy' | 'sell'
  readonly orderId: string
  readonly clientId?: string
  readonly openOrdersAccount: string
  readonly openOrdersSlot: number
  readonly feeTier: number
}

export interface ReceivedNewOrder extends Received {
  readonly reason: 'new'
  readonly orderType: 'limit' | 'ioc' | 'postOnly'
  readonly price: number
  readonly size: number
}

export interface ReceivedCancelOrder extends Received {
  readonly reason: 'cancel'
}

export interface Open extends DataMessage {
  readonly type: 'open'
  readonly price: number
  readonly size: number
  readonly side: 'buy' | 'sell' // liquidity taker side
  readonly order: OrderMeta
}

export interface Done extends DataMessage {
  readonly type: 'done'
}

export interface OpenOrders extends DataMessage {
  readonly type: 'openorders'
}
