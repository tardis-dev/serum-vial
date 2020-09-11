import { Op, Channel, MessageType } from './consts'

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

type OrderMeta = {
  id: string
  accountId: string
  clientId?: string
}

// TODO: review and finish remaining types
export interface Match extends DataMessage {
  readonly type: 'match'
  readonly price: number
  readonly size: number
  readonly side: 'buy' | 'sell' // liquidity taker side
  readonly id: string
  readonly makerOrder: OrderMeta
  readonly takerOrder: OrderMeta
}

export interface Received extends DataMessage {
  readonly type: 'received'
  readonly reason: 'new' | 'cancel'
  readonly orderType: 'limit' | 'ioc' | 'postOnly'

  readonly side: 'buy' | 'sell'
  readonly order: OrderMeta
  readonly price: number
  readonly size: number
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
