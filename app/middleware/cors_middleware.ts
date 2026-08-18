import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import env from '#start/env'
import { parseAllowedOrigins, resolveAllowedOrigin } from '#services/cors_policy'

export default class CorsMiddleware {
  handle({ request, response }: HttpContext, next: NextFn) {
    const defaults =
      env.get('NODE_ENV') === 'production'
        ? 'https://antirecurso.nei-isep.org'
        : 'http://localhost:3000,http://localhost:3001'
    const allowedOrigins = parseAllowedOrigins(env.get('CORS_ALLOWED_ORIGINS') ?? defaults)
    const requestOrigin = request.header('origin')
    const allowedOrigin = resolveAllowedOrigin(requestOrigin, allowedOrigins)

    if (allowedOrigin) {
      response.header('Access-Control-Allow-Origin', allowedOrigin)
    }
    response.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    response.header('Access-Control-Allow-Headers', 'Origin,Content-Type,Accept,Authorization')
    response.header('Access-Control-Max-Age', '86400')
    response.header('Vary', 'Origin')

    if (request.method() === 'OPTIONS') {
      if (requestOrigin && !allowedOrigin) {
        return response.forbidden({ message: 'Origin is not allowed' })
      }
      response.status(204)
      return response.send('')
    }

    return next()
  }
}
