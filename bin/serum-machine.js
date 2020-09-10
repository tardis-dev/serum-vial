#!/usr/bin/env node

const yargs = require('yargs')
const cluster = require('cluster')
const numCPUs = require('os').cpus().length
const isDocker = require('is-docker')
const pkg = require('../package.json')

const DEFAULT_PORT = 8000
const DEFAULT_NODE_ENDPOINT = 'https://solana-api.projectserum.com'
const argv = yargs
  .scriptName('serum-machine')
  .env('TM_')
  .strict()

  .option('port', {
    type: 'number',
    describe: 'Port to bind server on',
    default: DEFAULT_PORT
  })

  .option('endpoint', {
    type: 'string',
    describe: 'Serum node endpoint',
    default: DEFAULT_NODE_ENDPOINT
  })

  .option('cluster-mode', {
    type: 'boolean',
    describe: 'Run serum-machine as cluster of Node.js processes',
    default: false
  })

  .option('debug', {
    type: 'boolean',
    describe: 'Enable debug logs.',
    default: false
  })

  .help()
  .version()
  .usage('$0 [options]')
  .example(`$0 --endpoint ${DEFAULT_NODE_ENDPOINT}`)
  .epilogue('See https://github.com/tardis-dev/serum-machine for more information.')
  .detectLocale(false).argv

// if port ENV is defined use it otherwise use provided options
const port = process.env.PORT ? +process.env.PORT : argv['port']
const enableDebug = argv['debug']

if (enableDebug) {
  process.env.DEBUG = 'serum-machine*'
}

const { SerumMachine } = require('../dist')

async function start() {
  const machine = new SerumMachine({
    nodeEndpoint: argv['endpoint']
  })

  let suffix = ''

  const runAsCluster = argv['cluster-mode']
  if (runAsCluster) {
    cluster.schedulingPolicy = cluster.SCHED_RR

    suffix = ' in cluster mode'
    if (cluster.isMaster) {
      for (let i = 0; i < numCPUs; i++) {
        cluster.fork()
      }
    } else {
      await machine.start(port)
    }
  } else {
    await machine.start(port)
  }

  if (!cluster.isMaster) {
    return
  }

  if (isDocker() && !process.env.RUNKIT_HOST) {
    console.log(`Serum Machine v${pkg.version} is running inside Docker container${suffix}`)
  } else {
    console.log(`Serum Machine v${pkg.version} is running${suffix} on port ${port}`)
  }

  console.log(`See https://github.com/tardis-dev/serum-machine for more information.`)
}

start()

process
  .on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at Promise', reason, p)
  })
  .on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown', err)
    process.exit(1)
  })
