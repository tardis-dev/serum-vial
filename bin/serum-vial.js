#!/usr/bin/env node

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
    describe: 'Solana node endpoint',
    default: DEFAULT_NODE_ENDPOINT
  })

  .option('log-level', {
    type: 'string',
    describe: 'Enable debug logs.',
    choices: ['debug', 'info', 'warn', 'error'],
    default: 'info'
  })
  .option('minions-count', {
    type: 'number',
    describe: 'Minions worker threads count (handle WS pub/sub)',
    default: 1
  })

  .option('validate-l3-diffs', {
    type: 'boolean',
    describe: 'turn on validation of L3 diffs correctness (can impact perf)',
    default: false
  })

  .option('commitment', {
    type: 'string',
    describe: 'Solana commitment level to use when communicating with RPC node',
    choices: ['processed', 'confirmed'],
    default: 'confirmed'
  })

  .option('markets-json', {
    type: 'string',
    describe: 'Custom market.json definition file',
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
  let markets

  try {
    const customMarketsJsonPath = argv['markets-json']
    markets = require(marketsPath)
    logger.log(`Loaded custom markets from  ${customMarketsJsonPath}`)
  } catch {
    markets = getDefaultMarkets()
  }

  await bootServer({
    port,
    nodeEndpoint: argv['endpoint'],
    validateL3Diffs: argv['validate-l3-diffs'],
    minionsCount: argv['minions-count'],
    commitment: argv['commitment'],
    markets
  })

  if (isDocker()) {
    logger.log('info', `serum-vial v${pkg.version} is running inside Docker container.`)
  } else {
    logger.log('info', `serum-vial server v${pkg.version} is running on port ${port}.`)
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
