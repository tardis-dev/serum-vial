import os from 'os'
import path from 'path'
import { Worker } from 'worker_threads'
import { createDebugLogger } from './debug'
import { wait } from './helpers'
import { SerumProducer } from './serum-producer'

const debug = createDebugLogger('boot-server')

export async function bootServer({ port, nodeEndpoint }: BootOptions) {
  const serumProducer = new SerumProducer({ nodeEndpoint })
  await serumProducer.start()

  // multi core support is linux only feature which allows multiple threads to bind to the same port
  // see https://github.com/uNetworking/uWebSockets.js/issues/304 and https://lwn.net/Articles/542629/
  const WORKERS_COUNT = os.platform() === 'linux' ? os.cpus().length : 1

  const workers = [...Array(WORKERS_COUNT).keys()].map(() => {
    const serumMachineMinion = new Worker(path.resolve(__dirname, 'minion.js'), { workerData: { port } })

    serumMachineMinion.on('error', (err) => {
      debug('minion worker:%d error occured, %o', serumMachineMinion.threadId, err)
    })
    serumMachineMinion.on('exit', (code) => {
      debug('minion worker:%d died with code, %d', serumMachineMinion.threadId, code)
    })

    return serumMachineMinion
  })

  // wait just a bit for worker threads minions to start
  await wait(500)

  for await (const message of serumProducer.produce()) {
    // each message produced by serum producer needs to be broadcasted to minions
    for (let i = 0; i < workers.length; i++) {
      // data is passed as object using structured cloning for each worker, can this be a bottleneck? hmm
      workers[i].postMessage(message)
    }
  }
}

type BootOptions = {
  port: number
  nodeEndpoint: string
}
