import { randomUUID } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/

export function resolveRequestId(candidate: string | undefined): string {
  return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID()
}

export function requestLogLevel(status: number): 'info' | 'warn' | 'error' {
  if (status >= 500) return 'error'
  if (status >= 400) return 'warn'
  return 'info'
}

export default class RequestLoggingMiddleware {
  constructor(private rootLogger = logger) {}

  handle(ctx: HttpContext, next: NextFn) {
    const requestId = resolveRequestId(ctx.request.header('x-request-id'))
    ctx.request.headers()['x-request-id'] = requestId
    ctx.logger = this.rootLogger.child({ request_id: requestId })

    const startedAt = process.hrtime.bigint()
    const rawResponse = ctx.response.response

    rawResponse.once('close', () => {
      const status = ctx.response.getStatus()
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6

      ctx.logger[requestLogLevel(status)](
        {
          method: ctx.request.method(),
          route: ctx.route?.pattern ?? null,
          status,
          duration_ms: Math.round(durationMs * 10) / 10,
          user_id: ctx.authUser?.id ?? null,
          completed: rawResponse.writableFinished,
        },
        'request completed'
      )
    })

    return next()
  }
}
