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
    describe: 'Serum node endpoint',
    default: DEFAULT_NODE_ENDPOINT
  })

  .option('log-level', {
    type: 'string',
    describe: 'Enable debug logs.',
    choices: ['debug', 'info', 'warn', 'error'],
    default: 'error'
  })
  .option('test-mode', {
    type: 'boolean',
    describe: 'Enable test mode with full order book snapshots for each update',
    default: false
  })

  .help()
  .version()
  .usage('$0 [options]')
  .example(`$0 --endpoint ${DEFAULT_NODE_ENDPOINT}`)
  .epilogue('See https://github.com/tardis-dev/serum-vial for more information.')
  .detectLocale(false).argv

// if port ENV is defined use it otherwise use provided options
const port = process.env.PORT ? +process.env.PORT : argv['port']

const { bootServer, logger } = require('../dist')

logger.level = argv['log-level']

async function start() {
  await bootServer({
    port,
    nodeEndpoint: argv['endpoint'],
    testMode: argv['test-mode']
  })

  if (isDocker()) {
    logger.info(`Serum vial v${pkg.version} is running inside Docker container`)
  } else {
    logger.info(`Serum vial server v${pkg.version} is running on port ${port}`)
  }

  logger.info(`See https://github.com/tardis-dev/serum-vial for more information.`)
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
