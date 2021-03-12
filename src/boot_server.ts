import os from 'os'
import path from 'path'
import { Worker } from 'worker_threads'
import { minionReadyChannel, serumProducerReadyChannel, wait } from './helpers'
import { logger } from './logger'
import { ACTIVE_MARKETS_NAMES } from './markets'

export async function bootServer({ port, nodeEndpoint, testMode }: BootOptions) {
  logger.info('Starting minions...')

  // multi core support is linux only feature which allows multiple threads to bind to the same port
  // see https://github.com/uNetworking/uWebSockets.js/issues/304 and https://lwn.net/Articles/542629/
  const MINIONS_COUNT = os.platform() === 'linux' ? os.cpus().length : 1
  let readyMonionsCount = 0

  minionReadyChannel.onmessage = () => readyMonionsCount++

  // start minions workers and wait until all are ready

  for (let i = 0; i < MINIONS_COUNT; i++) {
    const minionWorker = new Worker(path.resolve(__dirname, 'minion.js'), { workerData: { nodeEndpoint, port } })

    minionWorker.on('error', (err) => {
      logger.warn(`minion worker ${minionWorker.threadId} error occured: ${err.message} ${err.stack}`)
      throw err
    })
    minionWorker.on('exit', (code) => {
      logger.warn(`minion worker: ${minionWorker.threadId} died with code: ${code}`)
    })
  }

  await new Promise<void>(async (resolve) => {
    while (true) {
      if (readyMonionsCount === MINIONS_COUNT) {
        break
      }
      await wait(100)
    }

    resolve()
  })

  logger.info('Minions ready...')

  logger.info('Starting serum producers...')

  let readyProducersCount = 0

  serumProducerReadyChannel.onmessage = () => readyProducersCount++

  for (const marketName of ACTIVE_MARKETS_NAMES) {
    const serumProducerWorker = new Worker(path.resolve(__dirname, 'serum-producer.js'), {
      workerData: { marketName, nodeEndpoint, testMode }
    })

    serumProducerWorker.on('error', (err) => {
      logger.warn(`serum producer worker ${serumProducerWorker.threadId} error occured: ${err.message} ${err.stack}`)
      throw err
    })

    serumProducerWorker.on('exit', (code) => {
      logger.warn(`serum producer worker: ${serumProducerWorker.threadId} died with code: ${code}`)
    })

    // just in case to not get hit by serum RPC node rate limits...
    await wait(300)
  }

  await new Promise<void>(async (resolve) => {
    while (true) {
      if (readyProducersCount === ACTIVE_MARKETS_NAMES.length) {
        break
      }
      await wait(100)
    }

    resolve()
  })

  logger.info('Serum producers ready...')
}

type BootOptions = {
  port: number
  nodeEndpoint: string
  testMode: boolean
}
