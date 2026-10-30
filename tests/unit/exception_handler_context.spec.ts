import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import HttpExceptionHandler from '#exceptions/handler'

type ContextReader = { context(ctx: HttpContext): Record<string, unknown> }

function contextFor(options: { pattern?: string; userId?: number }) {
  return {
    request: {
      id: () => 'web-7f3a9c1e-42',
      method: () => 'POST',
      url: () => '/exams/verify?token=query-secret',
    },
    route: options.pattern ? { pattern: options.pattern } : undefined,
    authUser: options.userId ? { id: options.userId } : undefined,
  } as unknown as HttpContext
}

test.group('Exception handler context', () => {
  test('adds method, route pattern and local user ID to reported errors', ({ assert }) => {
    const handler = new HttpExceptionHandler() as unknown as ContextReader

    const context = handler.context(contextFor({ pattern: '/exams/verify', userId: 9 }))

    assert.equal(context.method, 'POST')
    assert.equal(context.route, '/exams/verify')
    assert.equal(context.user_id, 9)
  })

  test('keeps the request ID and uses null for anonymous or unmatched requests', ({ assert }) => {
    const handler = new HttpExceptionHandler() as unknown as ContextReader

    const context = handler.context(contextFor({}))

    assert.equal(context['x-request-id'], 'web-7f3a9c1e-42')
    assert.isNull(context.route)
    assert.isNull(context.user_id)
  })

  test('never exposes the raw URL or query string', ({ assert }) => {
    const handler = new HttpExceptionHandler() as unknown as ContextReader

    const serialized = JSON.stringify(handler.context(contextFor({ pattern: '/exams/verify' })))

    assert.notInclude(serialized, 'query-secret')
    assert.notInclude(serialized, '?token')
  })
})
