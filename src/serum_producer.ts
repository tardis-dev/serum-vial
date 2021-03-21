import { Market } from '@project-serum/serum'
import { isMainThread, workerData } from 'worker_threads'
import { MessageType } from './consts'
import { DataMapper } from './data_mapper'
import { decimalPlaces, serumDataChannel, serumProducerReadyChannel } from './helpers'
import { logger } from './logger'
import { ACTIVE_MARKETS } from './markets'
import { RPCClient } from './rpc_client'

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
  constructor(private readonly _options: { nodeEndpoint: string; validateL3Diffs: boolean; marketName: string }) {}

  public async run(onData: OnDataCallback) {
    let started = false
    logger.log('info', `Serum producer starting for ${this._options.marketName} market...`, { options: this._options })

    const marketMeta = ACTIVE_MARKETS.find((m) => m.name == this._options.marketName)!

    // don't use Solana web3.js Connection but custom rpcClient so we have more control and insight what is going on
    const rpcClient = new RPCClient({ nodeEndpoint: this._options.nodeEndpoint })

    const market = await Market.load(rpcClient as any, marketMeta.address, undefined, marketMeta.programId)
    const priceDecimalPlaces = decimalPlaces(market.tickSize)
    const sizeDecimalPlaces = decimalPlaces(market.minOrderSize)

    const dataMapper = new DataMapper({
      symbol: this._options.marketName,
      market,
      priceDecimalPlaces,
      sizeDecimalPlaces,
      validateL3Diffs: this._options.validateL3Diffs
    })

    for await (const notification of rpcClient.streamAccountsNotification(market, this._options.marketName)) {
      if (started === false) {
        logger.log('info', `Serum producer started for ${this._options.marketName} market...`)
        started = true
        serumProducerReadyChannel.postMessage('ready')
      }

      if (notification.reset) {
        dataMapper.reset()
      } else {
        for (const message of dataMapper.map(notification)) {
          onData(message)
        }
      }
    }
  }
}

const serumProducer = new SerumProducer(workerData)

serumProducer.run((envelope) => {
  serumDataChannel.postMessage(envelope)
})

export type MessageEnvelope = {
  type: MessageType
  symbol: string
  publish: boolean
  payload: string
  timestamp: string
}

type OnDataCallback = (envelope: MessageEnvelope) => void
