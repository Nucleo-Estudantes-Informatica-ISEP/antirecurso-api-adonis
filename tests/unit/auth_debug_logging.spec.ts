import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import AuthMiddleware from '#middleware/auth_middleware'
import OptionalAuthMiddleware from '#middleware/optional_auth_middleware'
import type ZitadelAuthService from '#services/auth/zitadel_auth_service'
import { UnauthorizedError } from '#services/auth/zitadel_auth_service'

type Entry = { payload: Record<string, unknown>; message: string }

function contextFor(authorization: string) {
  const entries: Entry[] = []
  const ctx = {
    request: {
      header: (name: string) => (name === 'authorization' ? authorization : undefined),
      url: () => '/exams?access_token=query-secret',
      method: () => 'GET',
    },
    response: { unauthorized: () => undefined },
    logger: {
      warn: (payload: Record<string, unknown>, message: string) =>
        entries.push({ payload, message }),
    },
  } as unknown as HttpContext

  return { ctx, entries }
}

async function withAuthDebug(enabled: boolean, run: () => Promise<void>) {
  const previous = env.get('AUTH_DEBUG')
  env.set('AUTH_DEBUG', enabled)
  const originalWarn = console.warn
  const consoleCalls: unknown[][] = []
  console.warn = (...args: unknown[]) => {
    consoleCalls.push(args)
  }
  try {
    await run()
  } finally {
    console.warn = originalWarn
    env.set('AUTH_DEBUG', previous ?? false)
  }
  return consoleCalls
}

const rejectingService = {
  authenticateAuthorizationHeader: async () => {
    throw new UnauthorizedError('Token audience mismatch')
  },
} as unknown as ZitadelAuthService

test.group('Auth debug logging', () => {
  test('required auth logs rejections through the structured request logger', async ({
    assert,
  }) => {
    const { ctx, entries } = contextFor('Bearer very-secret-token')

    const consoleCalls = await withAuthDebug(true, () =>
      new AuthMiddleware(rejectingService, async () => true).handle(ctx, async () => {})
    )

    assert.lengthOf(entries, 1)
    assert.equal(entries[0].message, 'authentication rejected')
    assert.deepEqual(entries[0].payload, {
      middleware: 'auth',
      reason: 'Token audience mismatch',
      has_authorization_header: true,
    })
    assert.lengthOf(consoleCalls, 0)
  })

  test('optional auth logs rejections through the structured request logger', async ({
    assert,
  }) => {
    const { ctx, entries } = contextFor('Basic not-a-bearer-token')

    const consoleCalls = await withAuthDebug(true, () =>
      new OptionalAuthMiddleware().handle(ctx, async () => {})
    )

    assert.lengthOf(entries, 1)
    assert.equal(entries[0].message, 'authentication rejected')
    assert.equal(entries[0].payload.middleware, 'optionalAuth')
    assert.equal(entries[0].payload.reason, 'Invalid authorization header')
    assert.lengthOf(consoleCalls, 0)
  })

  test('rejection logs never include credentials or the request URL', async ({ assert }) => {
    const { ctx, entries } = contextFor('Bearer very-secret-token')

    await withAuthDebug(true, () =>
      new AuthMiddleware(rejectingService, async () => true).handle(ctx, async () => {})
    )

    const serialized = JSON.stringify(entries)
    assert.notInclude(serialized, 'very-secret-token')
    assert.notInclude(serialized, 'query-secret')
    assert.notInclude(serialized, '/exams')
  })

  test('stays silent when auth debugging is disabled', async ({ assert }) => {
    const { ctx, entries } = contextFor('Bearer very-secret-token')

    const consoleCalls = await withAuthDebug(false, () =>
      new AuthMiddleware(rejectingService, async () => true).handle(ctx, async () => {})
    )

    assert.lengthOf(entries, 0)
    assert.lengthOf(consoleCalls, 0)
  })
})
