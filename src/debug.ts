import dbg from 'debug'

export function createDebugLogger(prefix: string) {
  return dbg(`serum-machine:${prefix}`)
}
