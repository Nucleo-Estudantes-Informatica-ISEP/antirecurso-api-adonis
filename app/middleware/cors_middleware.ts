import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class CorsMiddleware {
  handle({ request, response }: HttpContext, next: NextFn) {
    response.header('Access-Control-Allow-Origin', '*')
    response.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    response.header('Access-Control-Allow-Headers', 'Origin,Content-Type,Accept,Authorization')
    response.header('Access-Control-Max-Age', '86400')
    response.header('Vary', 'Origin')

    if (request.method() === 'OPTIONS') {
      response.status(204)
      return response.send('')
    }

    return next()
  }
}
