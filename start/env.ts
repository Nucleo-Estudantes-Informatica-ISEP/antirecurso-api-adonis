/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Variables for configuring session package
  |----------------------------------------------------------
  */
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory'] as const),

  /*
  |----------------------------------------------------------
  | Variables for configuring database connection
  |----------------------------------------------------------
  */
  DB_HOST: Env.schema.string.optional({ format: 'host' }),
  DB_PORT: Env.schema.number.optional(),
  DB_USER: Env.schema.string.optional(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string.optional(),
  DB_URL: Env.schema.string(),
  DB_SSL: Env.schema.boolean.optional(),
  DB_SSL_REJECT_UNAUTHORIZED: Env.schema.boolean.optional(),

  /*
  |----------------------------------------------------------
  | Variables for verifying ZITADEL-issued OIDC tokens
  |----------------------------------------------------------
  */
  AUTH_ISSUER_URL: Env.schema.string(),
  AUTH_ALLOWED_AUDIENCES: Env.schema.string(),
  AUTH_ROLE_CLAIM: Env.schema.string.optional(),
  AUTH_DEBUG: Env.schema.boolean.optional(),
  CORS_ALLOWED_ORIGINS: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring Supabase Storage
  |----------------------------------------------------------
  */
  SUPABASE_URL: Env.schema.string.optional(),
  SUPABASE_SERVICE_ROLE_KEY: Env.schema.string.optional(),
  SUPABASE_STORAGE_BUCKET: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring the limiter package
  |----------------------------------------------------------
  */
  LIMITER_STORE: Env.schema.enum.optional(['database', 'memory'] as const),
})
