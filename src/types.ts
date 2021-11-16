import { Op, Channel, MessageType } from './consts'

export type EventQueueHeader = {
  seqNum: number
  head: number
  count: number
}

export type SubRequest = {
  readonly op: Op
  readonly channel: Channel
  readonly markets: string[]
}

export interface Message {
  readonly type: MessageType
  readonly timestamp: string
}

export interface RecentTrades extends Message {
  readonly type: 'recent_trades'
  readonly market: string
  readonly trades: Trade[]
}

export interface DataMessage extends Message {
  readonly market: string
  readonly version: number
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

export type PriceLevel = [string, string]

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
  readonly price: string
  readonly size: string
  readonly side: 'buy' | 'sell' // liquidity taker side
  readonly id: string
}

export interface Fill extends DataMessage, OrderItem {
  readonly type: 'fill'
  readonly maker: boolean
  readonly feeCost: number
}

export type OrderItem = {
  readonly price: string
  readonly size: string
  readonly side: 'buy' | 'sell'
  readonly orderId: string
  readonly clientId: string
  readonly account: string
  readonly accountSlot: number
  readonly feeTier: number
}

export interface Open extends DataMessage, OrderItem {
  readonly type: 'open'
}

export interface Done extends DataMessage {
  readonly type: 'done'
  readonly reason: 'filled' | 'canceled'
  readonly price: string | undefined
  readonly sizeRemaining: string | undefined
  readonly side: 'buy' | 'sell'
  readonly orderId: string
  readonly clientId?: string
  readonly account: string
  readonly accountSlot: number
}

export interface Change extends DataMessage, OrderItem {
  readonly type: 'change'
}

export interface L3Snapshot extends DataMessage {
  readonly type: 'l3snapshot'
  readonly asks: OrderItem[]
  readonly bids: OrderItem[]
}

export type L3DataMessage = Open | Fill | Done | L3Snapshot | Change

export type SerumListMarketItem = {
  name: string
  address: string
  baseCurrency: string
  quoteCurrency: string
  version: number
  programId: string
  baseMintAddress: string
  quoteMintAddress: string
  tickSize: number
  minOrderSize: number
  deprecated: boolean
}

export type SerumMarket = {
  address: string
  name: string
  programId: string
  deprecated: boolean
}
