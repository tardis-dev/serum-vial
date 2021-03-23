import winston from 'winston'

const { combine, timestamp, printf, colorize, uncolorize } = winston.format

const logFormat = printf(({ level, message, timestamp, ...rest }) => {
  const restString = JSON.stringify(rest)
  return `${timestamp} ${level}: ${message} ${restString === '{}' ? '' : restString}`
})

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'warn',
  format: combine(process.env.NODE_ENV !== 'production' ? uncolorize() : colorize(), timestamp(), logFormat),
  transports: [new winston.transports.Console()]
})
