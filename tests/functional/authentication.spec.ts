import { test } from '@japa/runner'
import env from '#start/env'
import ZitadelAuthService from '#services/auth/zitadel_auth_service'
import { createOidcFixture, installFetchMock, userPayload } from '#tests/helpers/token_factory'

test.group('Authentication boundaries', (group) => {
  let validToken: string
  let restoreFetch: () => void

  group.setup(async () => {
    ZitadelAuthService.clearCachesForTests()
    const fixture = await createOidcFixture()
    restoreFetch = installFetchMock(fixture.jwk)
    validToken = await fixture.sign(userPayload('auth-test-sub', 'auth-test@example.test'))
  })

  group.teardown(() => {
    restoreFetch()
    ZitadelAuthService.clearCachesForTests()
  })

  test('no token on protected route returns 401', async ({ client }) => {
    const res = await client.get('/exams')
    res.assertStatus(401)
    res.assertBodyContains({ message: 'Authentication required' })
  })

  test('non-bearer scheme returns 401', async ({ client }) => {
    const res = await client.get('/exams').header('authorization', 'Basic dXNlcjpwYXNz')
    res.assertStatus(401)
  })

  test('bearer with plain string (not a JWT) returns 401', async ({ client }) => {
    const res = await client.get('/exams').header('authorization', 'Bearer not-a-jwt')
    res.assertStatus(401)
    res.assertBodyContains({ message: 'Malformed access token' })
  })

  test('browser session marker returns 401', async ({ client }) => {
    const res = await client.get('/exams').header('authorization', 'Bearer server-session')
    res.assertStatus(401)
    res.assertBodyContains({ message: 'Malformed access token' })
  })

  test('expired token returns 401', async ({ client }) => {
    const issuer = env.get('AUTH_ISSUER_URL').replace(/\/+$/, '')
    const audience = env.get('AUTH_ALLOWED_AUDIENCES').split(',')[0].trim()
    // Expiry check happens before signature check, so a well-formed but expired
    // JWT with a dummy signature is sufficient to trigger the expiry rejection.
    const expiredToken = [
      Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'functional-test-key', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({
        iss: issuer,
        sub: 'expired-sub',
        aud: [audience],
        exp: Math.floor(Date.now() / 1000) - 60,
      })).toString('base64url'),
      'dummy-signature',
    ].join('.')

    const res = await client.get('/exams').header('authorization', `Bearer ${expiredToken}`)
    res.assertStatus(401)
    res.assertBodyContains({ message: 'Access token expired' })
  })

  test('token signed with unknown key returns 401', async ({ client }) => {
    // Sign with a keypair whose kid differs from the installed mock's kid.
    // The JWKS endpoint only advertises 'functional-test-key', so 'rogue-key'
    // is never found → "Unable to resolve token signing key".
    const rogue = await createOidcFixture('rogue-key')
    const rogueToken = await rogue.sign(userPayload('rogue-sub', 'rogue@example.test'))

    const res = await client.get('/exams').header('authorization', `Bearer ${rogueToken}`)
    res.assertStatus(401)
    res.assertBodyContains({ message: 'Unable to resolve token signing key' })
  })

  test('valid token on protected route is accepted', async ({ client, assert }) => {
    const res = await client.get('/exams').header('authorization', `Bearer ${validToken}`)
    res.assertStatus(200)
    assert.isArray(res.body().data)
  })

  test('no token on optional-auth route is allowed', async ({ client, assert }) => {
    const res = await client.get('/subjects/999999/notes')
    // 404 because subject doesn't exist, not 401 — optional auth passed through
    assert.notEqual(res.status(), 401)
  })
})
