import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { Op, Channel, MessageType, L3MessageType } from './consts'

export type AccountName = 'bids' | 'asks' | 'requestQueue' | 'eventQueue'
export type AccountsData = { [key in AccountName]: Buffer | undefined }

export type Request = {
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
  readonly timestamp: number
}

export interface DataMessage extends Message {
  readonly symbol: string
  readonly slot: number
}

export interface L3DataMessage extends Message {
  type: L3MessageType
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

export interface Fill extends DataMessage {
  readonly type: 'fill'
  readonly price: number
  readonly size: number
  readonly side: 'buy' | 'sell'
  readonly maker: boolean
  readonly feeCost: number
  readonly orderId: string
  readonly clientId?: string
  readonly openOrders: string
  readonly openOrdersSlot: number
  readonly feeTier: number
}

export interface OrderReceived extends DataMessage {
  readonly type: 'received'
  readonly reason: 'place' | 'cancel'
  readonly side: 'buy' | 'sell'
  readonly orderId: string
  readonly sequence: string
  readonly clientId?: string
  readonly openOrders: string
  readonly openOrdersSlot: number
  readonly feeTier: number
}

export interface PlaceOrderReceived extends OrderReceived {
  readonly reason: 'place'
  readonly orderType: 'limit' | 'ioc' | 'postOnly'
  readonly price: number
  readonly size: number
}

export interface CancelOrderReceived extends OrderReceived {
  readonly reason: 'cancel'
}

export type OrderItem = {
  readonly price: number
  readonly size: number
  readonly side: 'buy' | 'sell'
  readonly orderId: string
  readonly clientId?: string
  readonly openOrders: string
  readonly openOrdersSlot: number
  readonly feeTier: number
}

export interface OrderOpen extends DataMessage, OrderItem {
  readonly type: 'open'
}

export interface Done extends DataMessage {
  readonly type: 'done'
  readonly reason: 'filled' | 'canceled'
  readonly side: 'buy' | 'sell'
  readonly orderId: string
  readonly clientId?: string
  readonly openOrders: string
  readonly openOrdersSlot: number
  readonly feeTier: number
}

export interface L3Snapshot extends DataMessage {
  readonly type: 'l3snapshot'
  readonly orders: OrderItem[]
}
