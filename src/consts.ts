export const OPS = ['subscribe', 'unsubscribe'] as const
export const CHANNELS = ['level3', 'level2', 'level1', 'trades'] as const

const TRADES_MESSAGE_TYPES = ['recent_trades', 'trade'] as const
const LEVEL1_MESSAGE_TYPES = ['quote'] as const
const LEVEL2_MESSAGE_TYPES = ['l2snapshot', 'l2update'] as const
const LEVEL3_MESSAGE_TYPES = ['l3snapshot', 'open', 'fill', 'change', 'done'] as const

export const MESSAGE_TYPES_PER_CHANNEL: { [key in Channel]: readonly MessageType[] } = {
  trades: TRADES_MESSAGE_TYPES,
  level1: LEVEL1_MESSAGE_TYPES,
  level2: LEVEL2_MESSAGE_TYPES,
  level3: LEVEL3_MESSAGE_TYPES
}

export type Channel = typeof CHANNELS[number]
export type Op = typeof OPS[number]
export type MessageType =
  | typeof LEVEL3_MESSAGE_TYPES[number]
  | typeof LEVEL2_MESSAGE_TYPES[number]
  | typeof LEVEL1_MESSAGE_TYPES[number]
  | typeof TRADES_MESSAGE_TYPES[number]
  | 'error'
  | 'subscribed'
  | 'unsubscribed'

export type L3MessageType = typeof LEVEL3_MESSAGE_TYPES[number]
