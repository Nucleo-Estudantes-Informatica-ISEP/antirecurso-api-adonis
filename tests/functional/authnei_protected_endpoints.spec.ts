import { test } from '@japa/runner'
import { webcrypto } from 'node:crypto'
import env from '#start/env'
import ZitadelAuthService from '#services/auth/zitadel_auth_service'

const encoder = new TextEncoder()
let accessToken = ''
let originalFetch: typeof fetch

async function createSignedAccessToken() {
  const issuer = env.get('AUTH_ISSUER_URL').replace(/\/+$/, '')
  const audience = env.get('AUTH_ALLOWED_AUDIENCES').split(',')[0].trim()
  const keyPair = await webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  )
  const jwk = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey)
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'functional-authnei-key', typ: 'JWT' })
  ).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      sub: 'functional-authnei-subject',
      aud: [audience, 'authnei-web-client'],
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      scope: 'openid email profile offline_access',
      email: 'functional-authnei@isep.ipp.pt',
      email_verified: true,
      name: 'Functional AuthNEI Student',
    })
  ).toString('base64url')
  const input = `${header}.${payload}`
  const signature = await webcrypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keyPair.privateKey,
    encoder.encode(input)
  )

  originalFetch = globalThis.fetch
  globalThis.fetch = async (request) => {
    const url = String(request)
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({ issuer, jwks_uri: `${issuer}/oauth/v2/keys` })
    }
    if (url === `${issuer}/oauth/v2/keys`) {
      return Response.json({
        keys: [{ ...jwk, kid: 'functional-authnei-key', alg: 'RS256', use: 'sig' }],
      })
    }
    return originalFetch(request)
  }

  return `${input}.${Buffer.from(signature).toString('base64url')}`
}

test.group('AuthNEI protected endpoint groups', (group) => {
  group.setup(async () => {
    ZitadelAuthService.clearCachesForTests()
    accessToken = await createSignedAccessToken()
  })

  group.teardown(() => {
    globalThis.fetch = originalFetch
    ZitadelAuthService.clearCachesForTests()
  })

  test('accepts one production-shaped token for profile, history, exam, note, and mutation routes', async ({
    assert,
    client,
  }) => {
    const authorization = `Bearer ${accessToken}`

    const session = await client.get('/user').header('authorization', authorization)
    session.assertStatus(200)
    assert.equal(session.body().email, 'functional-authnei@isep.ipp.pt')
    assert.equal(session.body().requires_account_resolution, false)

    const history = await client.get('/exams').header('authorization', authorization)
    history.assertStatus(200)
    assert.deepEqual(history.body().data, [])

    // These resource requests intentionally use unknown IDs/empty bodies. A 404/422 proves the
    // shared AuthNEI middleware accepted the token and allowed each controller contract to run.
    const exam = await client
      .get('/exams/generate/999999?mode=hard')
      .header('authorization', authorization)
    exam.assertStatus(404)

    const note = await client.post('/notes/999999/view').header('authorization', authorization)
    note.assertStatus(404)

    const mutation = await client
      .post('/question-reports')
      .header('authorization', authorization)
      .json({})
    mutation.assertStatus(422)
  })

  test('fails closed for the browser session marker and missing credentials', async ({
    client,
  }) => {
    const marker = await client.get('/exams').header('authorization', 'Bearer server-session')
    marker.assertStatus(401)
    marker.assertBodyContains({ message: 'Malformed access token' })

    const missing = await client.get('/exams')
    missing.assertStatus(401)
    missing.assertBodyContains({ message: 'Authentication required' })
  })
})
