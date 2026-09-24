import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import AuthMiddleware from '#middleware/auth_middleware'
import type ZitadelAuthService from '#services/auth/zitadel_auth_service'
import { UnauthorizedError, type AuthClaims } from '#services/auth/zitadel_auth_service'

const claims: AuthClaims = {
  sub: 'production-subject',
  email: 'student@isep.ipp.pt',
  email_verified: true,
  name: 'Student',
  authNeiRoles: [],
}
const user = { id: 77 } as User

function contextFor(path: string, authorization = 'Bearer valid-authnei-token') {
  const result: { body?: unknown; status?: number } = {}
  const ctx = {
    request: {
      header: (name: string) => (name === 'authorization' ? authorization : undefined),
      url: () => path,
      method: () => (path.includes('/view') ? 'POST' : 'GET'),
    },
    response: {
      unauthorized: (body: unknown) => {
        result.status = 401
        result.body = body
      },
      forbidden: (body: unknown) => {
        result.status = 403
        result.body = body
      },
    },
  } as unknown as HttpContext

  return { ctx, result }
}

test.group('Protected endpoint AuthNEI middleware contract', () => {
  test('accepts the same valid bearer session across affected endpoint groups', async ({
    assert,
  }) => {
    const authService = {
      authenticateAuthorizationHeader: async (header: string | undefined) => {
        assert.equal(header, 'Bearer valid-authnei-token')
        return { accessToken: 'valid-authnei-token', claims, user }
      },
    } as unknown as ZitadelAuthService
    const middleware = new AuthMiddleware(authService, async () => true)

    for (const path of [
      '/exams/generate/17?mode=hard',
      '/exams',
      '/notes/42/view',
      '/user',
      '/user/scores',
      '/question-reports',
    ]) {
      const { ctx, result } = contextFor(path)
      let continued = false

      await middleware.handle(ctx, async () => {
        continued = true
      })

      assert.isTrue(continued, path)
      assert.equal(ctx.authUser?.id, 77, path)
      assert.equal(ctx.authClaims?.sub, 'production-subject', path)
      assert.isUndefined(result.status, path)
    }
  })

  test('continues to reject invalid bearer credentials', async ({ assert }) => {
    const authService = {
      authenticateAuthorizationHeader: async () => {
        throw new UnauthorizedError('Token audience mismatch')
      },
    } as unknown as ZitadelAuthService
    const middleware = new AuthMiddleware(authService, async () => true)
    const { ctx, result } = contextFor('/exams')

    await middleware.handle(ctx, async () => assert.fail('invalid tokens must not continue'))

    assert.equal(result.status, 401)
    assert.deepEqual(result.body, { message: 'Token audience mismatch' })
  })

  test('keeps pending accounts restricted to resolution endpoints', async ({ assert }) => {
    const authService = {
      authenticateAuthorizationHeader: async () => ({
        accessToken: 'valid-authnei-token',
        claims,
        user,
      }),
    } as unknown as ZitadelAuthService
    const middleware = new AuthMiddleware(authService, async () => false)
    const { ctx, result } = contextFor('/notes/42/view')

    await middleware.handle(ctx, async () => assert.fail('pending users must not continue'))

    assert.equal(result.status, 403)
    assert.deepEqual(result.body, {
      message: 'Account resolution required',
      requires_account_resolution: true,
    })
  })
})
