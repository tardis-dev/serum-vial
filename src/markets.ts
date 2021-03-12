import { MARKETS } from '@project-serum/serum'
import { PublicKey } from '@solana/web3.js'
import path from 'path'
import { logger } from './logger'

export type Market = typeof MARKETS[0]

let _markets: Market[]
try {
  const marketsPath = path.join(process.cwd(), 'markets.json')
  _markets = require(marketsPath).map((market: any) => {
    return {
      address: new PublicKey(market.address),
      name: market.name,
      programId: new PublicKey(market.programId),
      deprecated: market.deprecated
    }
  })

  logger.debug(`Loaded markets from ${marketsPath}`)
} catch {
  _markets = MARKETS.filter((m) => m.deprecated == false)
}

export const ACTIVE_MARKETS = _markets

export const ACTIVE_MARKETS_NAMES = ACTIVE_MARKETS.map((m) => m.name)

if (ACTIVE_MARKETS_NAMES.length !== [...new Set(ACTIVE_MARKETS_NAMES)].length) {
  throw new Error(
    "Markets can't have duplicated names as subscriptions allow subscribing by market name, not market address"
  )
}
