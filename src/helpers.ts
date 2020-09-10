import didYouMean from 'didyoumean2'

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
