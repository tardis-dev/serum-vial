import { MARKETS } from '@project-serum/serum'

export const OPS = ['subscribe', 'unsubscribe'] as const
export const CHANNELS = ['level3', 'level2', 'level1', 'trades'] as const

export const MESSAGE_TYPES = [
  'received',
  'open',
  'match',
  'done',
  'l2update',
  'l2snapshot',
  'openorders',
  'subscribed',
  'quote',
  'unsubscribed',
  'error'
] as const

export const MESSAGE_TYPES_PER_CHANNEL: { [key in Channel]: MessageType[] } = {
  trades: ['match'],
  level1: ['quote', 'match'],
  level2: ['l2snapshot', 'l2update', 'match'],
  level3: ['openorders', 'received', 'open', 'match', 'done']
}

export const MARKETS_SYMBOLS = MARKETS.map((m) => m.name)

// WS pubsub system uses MQTT syntax for which '/' '+' and '#' are special characters
// let's make sure we don't have those in provided market names when used as pub/sub topics
export const PUB_TOPIC_NAME_FOR_MARKET: { [key: string]: string } = {}

for (const market of MARKETS_SYMBOLS) {
  PUB_TOPIC_NAME_FOR_MARKET[market] = market.replace(/[^\w]/gi, '')
}

export type Channel = typeof CHANNELS[number]
export type Op = typeof OPS[number]
export type MessageType = typeof MESSAGE_TYPES[number]
