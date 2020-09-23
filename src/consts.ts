import { MARKETS } from '@project-serum/serum'

export const OPS = ['subscribe', 'unsubscribe'] as const
export const CHANNELS = ['level3', 'level2', 'level1', 'trades'] as const

const TRADES_MESSAGE_TYPES = ['trade'] as const
const LEVEL1_MESSAGE_TYPES = ['quote', 'trade'] as const
const LEVEL2_MESSAGE_TYPES = ['l2snapshot', 'l2update', 'trade'] as const
const LEVEL3_MESSAGE_TYPES = ['l3snapshot', 'received', 'open', 'fill', 'done'] as const

export const MESSAGE_TYPES_PER_CHANNEL: { [key in Channel]: readonly MessageType[] } = {
  trades: TRADES_MESSAGE_TYPES,
  level1: LEVEL1_MESSAGE_TYPES,
  level2: LEVEL2_MESSAGE_TYPES,
  level3: LEVEL3_MESSAGE_TYPES
}

export const MARKETS_SYMBOLS = MARKETS.map((m) => m.name)

export const MARKETS_LIST = MARKETS.filter((m) => m.deprecated === false)

// WS pubsub system uses MQTT syntax for which '/' '+' and '#' are special characters
// let's make sure we don't have those in provided market names when used as pub/sub topics
export const PUB_TOPIC_NAME_FOR_MARKET: { [key: string]: string } = {}

for (const market of MARKETS_SYMBOLS) {
  PUB_TOPIC_NAME_FOR_MARKET[market] = market.replace(/[^\w]/gi, '')
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
