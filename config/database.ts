import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbSslEnabled = env.get('DB_SSL')

const dbConfig = defineConfig({
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: {
        connectionString: env.get('DB_URL'),
        ...(dbSslEnabled
          ? {
              ssl: {
                rejectUnauthorized: env.get('DB_SSL_REJECT_UNAUTHORIZED'),
              },
            }
          : {}),
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig
