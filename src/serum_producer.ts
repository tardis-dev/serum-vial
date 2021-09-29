import { Market } from '@project-serum/serum'
import { PublicKey } from '@solana/web3.js'
import { isMainThread, workerData } from 'worker_threads'
import { MessageType } from './consts'
import { DataMapper } from './data_mapper'
import { decimalPlaces, partitionDetectedChannel, serumDataChannel, serumProducerReadyChannel } from './helpers'
import { logger } from './logger'
import { RPCClient } from './rpc_client'
import { SerumMarket } from './types'

if (isMainThread) {
  const message = 'Exiting. Worker is not meant to run in main thread'
  logger.log('error', message)

  throw new Error(message)
}

process.on('unhandledRejection', (err) => {
  throw err
})

// SerumProducer responsibility is to:
// - connect to Serum Node RPC API via WS and subscribe to single Serum market
// - map received data to normalized data messages and broadcast those

export class SerumProducer {
  constructor(
    private readonly _options: {
      nodeEndpoint: string
      wsEndpointPort: number | undefined
      marketName: string
      commitment: string
      markets: SerumMarket[]
    }
  ) {}

  public async run(onData: OnDataCallback) {
    let started = false
    logger.log('info', `Serum producer starting for ${this._options.marketName} market...`)

    const marketMeta = this._options.markets.find((m) => m.name == this._options.marketName)!

    // don't use Solana web3.js Connection but custom rpcClient so we have more control and insight what is going on
    const rpcClient = new RPCClient({
      nodeEndpoint: this._options.nodeEndpoint,
      commitment: this._options.commitment,
      wsEndpointPort: this._options.wsEndpointPort
    })

    const market = await Market.load(
      rpcClient as any,
      new PublicKey(marketMeta.address),
      undefined,
      new PublicKey(marketMeta.programId)
    )

    const priceDecimalPlaces = decimalPlaces(market.tickSize)
    const sizeDecimalPlaces = decimalPlaces(market.minOrderSize)

    const dataMapper = new DataMapper({
      symbol: this._options.marketName,
      market,
      priceDecimalPlaces,
      sizeDecimalPlaces,
      onPartitionDetected: () => {
        partitionDetectedChannel.postMessage('partition-detected')
        rpcClient.reset()
      }
    })

    partitionDetectedChannel.onmessage = () => {
      rpcClient.reset()
    }

    for await (const notification of rpcClient.streamAccountsNotification(market, this._options.marketName)) {
      if (started === false) {
        logger.log('info', `Serum producer started for ${this._options.marketName} market...`)
        started = true
        serumProducerReadyChannel.postMessage('ready')
      }

      if (notification.reset) {
        dataMapper.reset()
      } else {
        const messagesForSlot = [...dataMapper.map(notification)]
        if (messagesForSlot.length > 0) {
          onData(messagesForSlot)
        }
      }
    }
  }
}

const serumProducer = new SerumProducer(workerData)

serumProducer.run((envelopes) => {
  serumDataChannel.postMessage(envelopes)
})

export type MessageEnvelope = {
  type: MessageType
  market: string
  publish: boolean
  payload: string
  timestamp: string
}

type OnDataCallback = (envelopes: MessageEnvelope[]) => void
