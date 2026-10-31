import { Writable } from 'node:stream'
import pino from 'pino'
import loggerConfig from '#config/logger'

export function captureLogger() {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString())
      callback()
    },
  })
  const { redact, hooks } = loggerConfig.loggers.app
  const instance = pino({ redact, hooks }, stream)
  return { instance, lines }
}
