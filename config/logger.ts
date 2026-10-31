import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, targets } from '@adonisjs/core/logger'

const loggerConfig = defineConfig({
  default: 'app',

  /**
   * The loggers object can be used to define multiple loggers.
   * By default, we configure only one logger (named "app").
   */
  loggers: {
    app: {
      enabled: true,
      name: env.get('APP_NAME'),
      level: env.get('LOG_LEVEL'),
      hooks: {
        streamWrite(line) {
          const entry = JSON.parse(line)
          if (typeof entry.err?.code === 'string' && /^[0-9A-Z]{5}$/.test(entry.err.code)) {
            // PostgreSQL may echo bindings in message, stack and nested causes.
            entry.err = { type: 'DatabaseError', code: entry.err.code }
            entry.msg = 'database operation failed'
            return JSON.stringify(entry) + '\n'
          }
          return line
        },
      },
      redact: {
        paths: [
          'authorization',
          'password',
          'token',
          'access_token',
          'refresh_token',
          'id_token',
          '*.authorization',
          '*.password',
          '*.token',
          '*.access_token',
          '*.refresh_token',
          '*.id_token',
          '*.headers.authorization',
          '*.headers.cookie',
          'err.detail',
          'err.where',
        ],
        censor: '[redacted]',
      },
      transport: {
        targets: targets()
          .pushIf(!app.inProduction, targets.pretty())
          .pushIf(app.inProduction, targets.file({ destination: 1 }))
          .toArray(),
      },
    },
  },
})

export default loggerConfig

/**
 * Inferring types for the list of loggers you have configured
 * in your application.
 */
declare module '@adonisjs/core/types' {
  export interface LoggersList extends InferLoggers<typeof loggerConfig> {}
}
