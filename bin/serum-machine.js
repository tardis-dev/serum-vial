#!/usr/bin/env node

const yargs = require('yargs')
const isDocker = require('is-docker')
const pkg = require('../package.json')

const DEFAULT_PORT = 8000
const DEFAULT_NODE_ENDPOINT = 'https://solana-api.projectserum.com'
const argv = yargs
  .scriptName('serum-machine')
  .env('SM_')
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

const { bootServer } = require('../dist')

async function start() {
  await bootServer({
    port,
    nodeEndpoint: argv['endpoint']
  })

  if (isDocker() && !process.env.RUNKIT_HOST) {
    console.log(`Serum Machine v${pkg.version} is running inside Docker container`)
  } else {
    console.log(`Serum Machine v${pkg.version} is running on port ${port}`)
  }

  console.log(`See https://github.com/tardis-dev/serum-machine for more information.`)
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
