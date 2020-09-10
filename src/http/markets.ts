import { HttpResponse } from 'uWebSockets.js'
import { MARKETS } from '@project-serum/serum'

const marketsResponse = JSON.stringify(
  MARKETS.map((market) => {
    return {
      name: market.name,
      address: market.address.toString(),
      programId: market.programId.toString(),
      deprecated: market.deprecated
    }
  }),
  null,
  2
)

export const listMarkets = (res: HttpResponse) => {
  res.writeHeader('content-type', 'application/json')
  res.end(marketsResponse)
}
