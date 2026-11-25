import { EventEmitter } from 'node:events'
import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import RequestLoggingMiddleware, {
  requestLogLevel,
  resolveRequestId,
} from '#middleware/request_logging_middleware'

type LogEntry = {
  level: string
  bindings: Record<string, unknown>
  payload: unknown
  message?: string
}

function recordingLogger() {
  const entries: LogEntry[] = []
  const build = (bindings: Record<string, unknown>) => ({
    child: (extra: Record<string, unknown>) => build({ ...bindings, ...extra }),
    info: (payload: unknown, message?: string) =>
      entries.push({ level: 'info', bindings, payload, message }),
    warn: (payload: unknown, message?: string) =>
      entries.push({ level: 'warn', bindings, payload, message }),
    error: (payload: unknown, message?: string) =>
      entries.push({ level: 'error', bindings, payload, message }),
  })
  return { entries, root: build({}) }
}

function contextFor(options: {
  requestId?: string
  status?: number
  pattern?: string | null
  userId?: number
  url?: string
}) {
  const headers: Record<string, string> = {}
  if (options.requestId !== undefined) headers['x-request-id'] = options.requestId
  const raw = Object.assign(new EventEmitter(), { writableFinished: true })
  const ctx = {
    request: {
      headers: () => headers,
      header: (name: string) => headers[name],
      method: () => 'GET',
      url: () => options.url ?? '/subjects/12?token=secret',
    },
    response: {
      response: raw,
      getStatus: () => options.status ?? 200,
    },
    route: options.pattern === null ? undefined : { pattern: options.pattern ?? '/subjects/:id' },
    authUser: options.userId ? { id: options.userId } : undefined,
    logger: undefined as unknown,
  } as unknown as HttpContext

  return { ctx, headers, raw }
}

test.group('Request ID resolution', () => {
  test('keeps a well-formed client request ID', ({ assert }) => {
    assert.equal(resolveRequestId('web-7f3a9c1e-42'), 'web-7f3a9c1e-42')
    assert.equal(
      resolveRequestId('550e8400-e29b-41d4-a716-446655440000'),
      '550e8400-e29b-41d4-a716-446655440000'
    )
  })

  test('replaces missing, short, long and unsafe request IDs', ({ assert }) => {
    for (const candidate of [
      undefined,
      '',
      'abc',
      'a'.repeat(129),
      'has space inside',
      'line\nbreak-1234',
      '<script>alert(1)</script>',
      'Bearer eyJhbGciOiJSUzI1NiJ9.payload.signature',
    ]) {
      const resolved = resolveRequestId(candidate)
      assert.notEqual(resolved, candidate)
      assert.match(resolved, /^[0-9a-f-]{36}$/)
    }
  })
})

test.group('Request log level', () => {
  test('maps response status to severity', ({ assert }) => {
    assert.equal(requestLogLevel(200), 'info')
    assert.equal(requestLogLevel(304), 'info')
    assert.equal(requestLogLevel(404), 'warn')
    assert.equal(requestLogLevel(429), 'warn')
    assert.equal(requestLogLevel(500), 'error')
    assert.equal(requestLogLevel(503), 'error')
  })
})

test.group('Request logging middleware', () => {
  test('propagates a valid client request ID to the request and its logger', async ({ assert }) => {
    const { entries, root } = recordingLogger()
    const { ctx, headers, raw } = contextFor({ requestId: 'web-7f3a9c1e-42' })

    await new RequestLoggingMiddleware(root as never).handle(ctx, async () => {})
    raw.emit('close')

    assert.equal(headers['x-request-id'], 'web-7f3a9c1e-42')
    assert.lengthOf(entries, 1)
    assert.equal(entries[0].bindings.request_id, 'web-7f3a9c1e-42')
  })

  test('replaces an unsafe client request ID before it reaches headers or logs', async ({
    assert,
  }) => {
    const { entries, root } = recordingLogger()
    const { ctx, headers, raw } = contextFor({ requestId: 'bad id\nforged-entry' })

    await new RequestLoggingMiddleware(root as never).handle(ctx, async () => {})
    raw.emit('close')

    assert.match(headers['x-request-id'], /^[0-9a-f-]{36}$/)
    assert.equal(entries[0].bindings.request_id, headers['x-request-id'])
  })

  test('generates a request ID when the client sends none', async ({ assert }) => {
    const { root } = recordingLogger()
    const { ctx, headers } = contextFor({})

    await new RequestLoggingMiddleware(root as never).handle(ctx, async () => {})

    assert.match(headers['x-request-id'], /^[0-9a-f-]{36}$/)
  })

  test('logs method, route pattern, status, duration and local user ID once on close', async ({
    assert,
  }) => {
    const { entries, root } = recordingLogger()
    const { ctx, raw } = contextFor({ status: 201, userId: 42 })

    await new RequestLoggingMiddleware(root as never).handle(ctx, async () => {})
    raw.emit('close')
    raw.emit('close')

    assert.lengthOf(entries, 1)
    assert.equal(entries[0].level, 'info')
    assert.equal(entries[0].message, 'request completed')
    const payload = entries[0].payload as Record<string, unknown>
    assert.equal(payload.method, 'GET')
    assert.equal(payload.route, '/subjects/:id')
    assert.equal(payload.status, 201)
    assert.equal(payload.user_id, 42)
    assert.equal(payload.completed, true)
    assert.isNumber(payload.duration_ms)
    assert.isAtLeast(payload.duration_ms as number, 0)
  })

  test('never logs the raw URL, query string or credentials', async ({ assert }) => {
    const { entries, root } = recordingLogger()
    const { ctx, raw } = contextFor({ url: '/notes/9/file?token=super-secret-token', userId: 5 })

    await new RequestLoggingMiddleware(root as never).handle(ctx, async () => {})
    raw.emit('close')

    const serialized = JSON.stringify(entries)
    assert.notInclude(serialized, 'super-secret-token')
    assert.notInclude(serialized, '?token')
    assert.notInclude(serialized.toLowerCase(), 'authorization')
  })

  test('logs unmatched routes without a route pattern and warns on client errors', async ({
    assert,
  }) => {
    const { entries, root } = recordingLogger()
    const { ctx, raw } = contextFor({ status: 404, pattern: null })

    await new RequestLoggingMiddleware(root as never).handle(ctx, async () => {})
    raw.emit('close')

    assert.equal(entries[0].level, 'warn')
    assert.isNull((entries[0].payload as Record<string, unknown>).route)
  })

  test('reports server errors at error level and flags aborted responses', async ({ assert }) => {
    const { entries, root } = recordingLogger()
    const { ctx, raw } = contextFor({ status: 500 })
    raw.writableFinished = false

    await new RequestLoggingMiddleware(root as never).handle(ctx, async () => {})
    raw.emit('close')

    assert.equal(entries[0].level, 'error')
    assert.equal((entries[0].payload as Record<string, unknown>).completed, false)
  })
})
