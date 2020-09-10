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

export interface L2 extends Message {
  readonly type: 'l2update' | 'l2snapshot'
  readonly symbol: string
  readonly asks: PriceLevel[]
  readonly bids: PriceLevel[]
}

export interface Quote extends Message {
  readonly type: 'quote'
  readonly symbol: string
  readonly bestAsk: PriceLevel | undefined
  readonly bestBid: PriceLevel | undefined
}

type OrderMeta = {
  id: string
  accountId: string
  clientId?: string
}

// TODO: review and finish remaining types
export interface Match extends Message {
  readonly type: 'match'
  readonly symbol: string
  readonly price: number
  readonly size: number
  readonly side: 'buy' | 'sell' // liquidity taker side
  readonly id: string
  readonly makerOrder: OrderMeta
  readonly takerOrder: OrderMeta
}

export interface Received extends Message {
  readonly type: 'received'
  readonly symbol: string
  readonly reason: 'new' | 'cancel'
  readonly orderType: 'limit' | 'ioc' | 'postOnly'

  readonly side: 'buy' | 'sell'
  readonly order: OrderMeta
  readonly price: number
  readonly size: number
}

export interface Open extends Message {
  readonly type: 'open'
  readonly symbol: string
  readonly price: number
  readonly size: number
  readonly side: 'buy' | 'sell' // liquidity taker side
  readonly order: OrderMeta
}

export interface Done extends Message {
  readonly type: 'done'
}

export interface L3Snapshot extends Message {
  readonly type: 'l3snapshot'
}
