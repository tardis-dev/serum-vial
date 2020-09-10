import { SerumMachine } from '../src'

const PORT = 8072
// const WS_STREAMS_URL = `ws://localhost:${PORT}/stream`

describe('Serum Machine', () => {
  let serumMachine: SerumMachine

  beforeAll(async () => {
    serumMachine = new SerumMachine({ nodeEndpoint: 'https://solana-api.projectserum.com' })
    await serumMachine.start(PORT) // start server
  })

  afterAll(async () => {
    await serumMachine.stop()
  })

  test('hello', () => {})
})
