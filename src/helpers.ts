import { MARKETS } from '@project-serum/serum'
import didYouMean from 'didyoumean2'
import { SerumMarket } from './types'

export const wait = (delayMS: number) => new Promise((resolve) => setTimeout(resolve, delayMS))

export function getDidYouMean(input: string, allowedValues: readonly string[]) {
  let tip = ''

  if (typeof input === 'string') {
    let result = didYouMean(input, allowedValues, {})
    if (result !== null) {
      tip = ` Did you mean '${result}'?`
    }
  }
  return tip
}

export function getAllowedValuesText(allowedValues: readonly string[]) {
  return `Allowed values: ${allowedValues.map((val) => `'${val}'`).join(', ')}.`
}

export function* batch<T>(items: T[], batchSize: number) {
  for (let i = 0; i < items.length; i += batchSize) {
    yield items.slice(i, i + batchSize)
  }
}

// https://stackoverflow.com/questions/9539513/is-there-a-reliable-way-in-javascript-to-obtain-the-number-of-decimal-places-of?noredirect=1&lq=1

export function decimalPlaces(n: number) {
  // Make sure it is a number and use the builtin number -> string.
  var s = '' + +n
  // Pull out the fraction and the exponent.
  var match = /(?:\.(\d+))?(?:[eE]([+\-]?\d+))?$/.exec(s)
  // NaN or Infinity or integer.
  // We arbitrarily decide that Infinity is integral.
  if (!match) {
    return 0
  }
  // Count the number of digits in the fraction and subtract the
  // exponent to simulate moving the decimal point left by exponent places.
  // 1.234e+2 has 1 fraction digit and '234'.length -  2 == 1
  // 1.234e-2 has 5 fraction digit and '234'.length - -2 == 5

  return Math.max(
    0, // lower limit.
    (match[1] == '0' ? 0 : (match[1] || '').length) - // fraction length
      (+match[2]! || 0)
  ) // exponent
}

export class CircularBuffer<T> {
  private _buffer: T[] = []
  private _index: number = 0
  constructor(private readonly _bufferSize: number) {}

  append(value: T) {
    const isFull = this._buffer.length === this._bufferSize
    let poppedValue
    if (isFull) {
      poppedValue = this._buffer[this._index]
    }
    this._buffer[this._index] = value
    this._index = (this._index + 1) % this._bufferSize

    return poppedValue
  }

  *items() {
    for (let i = 0; i < this._buffer.length; i++) {
      const index = (this._index + i) % this._buffer.length
      yield this._buffer[index]
    }
  }

  get count() {
    return this._buffer.length
  }

  clear() {
    this._buffer = []
    this._index = 0
  }
}

const { BroadcastChannel } = require('worker_threads')

export const minionReadyChannel = new BroadcastChannel('MinionReady') as BroadcastChannel
export const serumProducerReadyChannel = new BroadcastChannel('SerumProducerReady') as BroadcastChannel
export const serumDataChannel = new BroadcastChannel('SerumData') as BroadcastChannel
export const serumMarketsChannel = new BroadcastChannel('SerumMarkets') as BroadcastChannel

export async function executeAndRetry<T>(
  operation: (attempt: number) => Promise<T>,
  { maxRetries }: { maxRetries: number }
): Promise<T> {
  let attempts = 0
  while (true) {
    attempts++
    try {
      return await operation(attempts)
    } catch (err) {
      if (attempts > maxRetries) {
        throw err
      }

      await wait(500 * attempts * attempts)
    }
  }
}

export function getDefaultMarkets(): SerumMarket[] {
  const defaultMarkets: SerumMarket[] = []

  for (const market of MARKETS) {
    if (market.deprecated) {
      continue
    }

    if (defaultMarkets.some((s) => s.name === market.name)) {
      continue
    }

    defaultMarkets.push({
      name: market.name,
      address: market.address.toBase58(),
      programId: market.programId.toBase58(),
      deprecated: false
    })
  }

  return defaultMarkets
}
