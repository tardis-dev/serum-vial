import { Market, MARKETS } from '@project-serum/serum'
import { Connection } from '@solana/web3.js'
import { HttpResponse } from 'uWebSockets.js'

let cachedListMarketsResponse: string | undefined

async function getListMarketsResponse(nodeEndpoint: string) {
  if (cachedListMarketsResponse !== undefined) {
    return cachedListMarketsResponse
  }

  const markets = await Promise.all(
    MARKETS.map(async (market) => {
      const connection = new Connection(nodeEndpoint)
      const { tickSize, minOrderSize, supportsReferralFees, supportsSrmFeeDiscounts } = await Market.load(
        connection,
        market.address,
        undefined,
        market.programId
      )

      return {
        symbol: market.name,
        address: market.address.toString(),
        programId: market.programId.toString(),
        tickSize,
        minOrderSize,
        supportsReferralFees,
        supportsSrmFeeDiscounts
      }
    })
  )

  cachedListMarketsResponse = JSON.stringify(markets, null, 2)

  return cachedListMarketsResponse
}

// async based on https://github.com/uNetworking/uWebSockets.js/blob/master/examples/AsyncFunction.js
export const listMarkets = (nodeEndpoint: string) => async (res: HttpResponse) => {
  res.onAborted(() => {
    res.aborted = true
  })

  const listMarketsResponse = await getListMarketsResponse(nodeEndpoint)

  if (!res.aborted) {
    res.writeHeader('content-type', 'application/json')
    res.end(listMarketsResponse)
  }
}
