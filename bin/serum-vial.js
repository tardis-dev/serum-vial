#!/usr/bin/env node

const path = require('path')
const yargs = require('yargs')
const isDocker = require('is-docker')
const pkg = require('../package.json')

const DEFAULT_PORT = 8000
const DEFAULT_NODE_ENDPOINT = 'https://solana-api.projectserum.com'

const argv = yargs
  .scriptName('serum-vial')
  .env('SV_')
  .strict()

  .option('port', {
    type: 'number',
    describe: 'Port to bind server on',
    default: DEFAULT_PORT
  })

  .option('endpoint', {
    type: 'string',
    describe: 'Solana RPC node endpoint that serum-vial uses as a data source',
    default: DEFAULT_NODE_ENDPOINT
  })

  .option('ws-endpoint-port', {
    type: 'number',
    describe:
      'Optional Solana RPC WS node endpoint port that serum-vial uses as a data source (if different than REST endpoint port)',
    default: undefined
  })

  .option('log-level', {
    type: 'string',
    describe: 'Log level',
    choices: ['debug', 'info', 'warn', 'error'],
    default: 'info'
  })
  .option('minions-count', {
    type: 'number',
    describe:
      'Minions worker threads count that are responsible for broadcasting normalized WS messages to connected clients',
    default: 1
  })

  .option('commitment', {
    type: 'string',
    describe: 'Solana commitment level to use when communicating with RPC node',
    choices: ['processed', 'confirmed'],
    default: 'confirmed'
  })

  .option('markets-json', {
    type: 'string',
    describe: 'Path to custom market.json definition file',
    default: ''
  })

  .help()
  .version()
  .usage('$0 [options]')
  .example(`$0 --endpoint ${DEFAULT_NODE_ENDPOINT}`)
  .epilogue('See https://github.com/tardis-dev/serum-vial for more information.')
  .detectLocale(false).argv

// if port ENV is defined use it otherwise use provided options
const port = process.env.PORT ? +process.env.PORT : argv['port']
process.env.LOG_LEVEL = argv['log-level']

const { bootServer, logger, getDefaultMarkets } = require('../dist')

async function start() {
  let markets = getDefaultMarkets()
  const marketsJsonPath = argv['markets-json']
  if (marketsJsonPath) {
    try {
      const fullPath = path.join(process.cwd(), argv['markets-json'])
      markets = require(fullPath)
      logger.log('info', `Loaded custom markets from ${fullPath}`)
    } catch {
      markets = getDefaultMarkets()
    }
  }

  const options = {
    port,
    nodeEndpoint: argv['endpoint'],
    wsEndpointPort: argv['ws-endpoint-port'],
    minionsCount: argv['minions-count'],
    commitment: argv['commitment']
  }

  logger.log('info', 'Starting serum-vial server with options', options)

  const startTimestamp = new Date().valueOf()
  await bootServer({
    ...options,
    markets
  })

  const bootTimeSeconds = Math.ceil((new Date().valueOf() - startTimestamp) / 1000)

  if (isDocker()) {
    logger.log('info', `Serum-vial v${pkg.version} is running inside Docker container.`, { bootTimeSeconds })
  } else {
    logger.log('info', `Serum-vial server v${pkg.version} is running on port ${port}.`, { bootTimeSeconds })
  }

  logger.log('info', `See https://github.com/tardis-dev/serum-vial for more information.`)
}

start()

process
  .on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at Promise', reason, p)
    process.exit(1)
  })
  .on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown', err)
    process.exit(1)
  })
