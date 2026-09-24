import { test } from '@japa/runner'
import { webcrypto } from 'node:crypto'
import env from '#start/env'
import type User from '#models/user'
import ZitadelAuthService, {
  UnauthorizedError,
  type AuthClaims,
} from '#services/auth/zitadel_auth_service'

const encoder = new TextEncoder()

async function signingFixture(kid: string) {
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
  const publicJwk = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey)

  return {
    jwk: { ...publicJwk, kid, alg: 'RS256', use: 'sig' },
    async sign(payload: Record<string, unknown>) {
      const encodedHeader = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString(
        'base64url'
      )
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
      const input = `${encodedHeader}.${encodedPayload}`
      const signature = await webcrypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        keyPair.privateKey,
        encoder.encode(input)
      )
      return `${input}.${Buffer.from(signature).toString('base64url')}`
    },
  }
}

test.group('ZITADEL access-token validation', (group) => {
  group.each.setup(() => ZitadelAuthService.clearCachesForTests())

  test('accepts production-equivalent AuthNEI claims and resolves the token subject', async ({
    assert,
  }) => {
    const issuer = env.get('AUTH_ISSUER_URL').replace(/\/+$/, '')
    const audience = env.get('AUTH_ALLOWED_AUDIENCES').split(',')[0].trim()
    const roleClaim = env.get('AUTH_ROLE_CLAIM') ?? 'urn:zitadel:iam:org:project:roles'
    const fixture = await signingFixture('production-key')
    const token = await fixture.sign({
      iss: `${issuer}/`,
      sub: 'authnei-production-subject',
      aud: [audience, 'authnei-web-client'],
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      scope: 'openid email profile offline_access',
      [roleClaim]: { admin: { 'org-id': 'nei' } },
    })
    let resolvedClaims: AuthClaims | undefined
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer: `${issuer}/`,
          jwks_uri: `${issuer}/oauth/v2/keys`,
          userinfo_endpoint: `${issuer}/oidc/v1/userinfo`,
        })
      }
      if (url.endsWith('/oauth/v2/keys')) return Response.json({ keys: [fixture.jwk] })
      if (url.endsWith('/oidc/v1/userinfo')) {
        return Response.json({
          sub: 'authnei-production-subject',
          email: 'student@isep.ipp.pt',
          email_verified: true,
          name: 'Production Student',
        })
      }
      throw new Error(`Unexpected identity request: ${url}`)
    }
    const service = new ZitadelAuthService({
      fetchImpl: fetchMock,
      resolveUser: async (claims) => {
        resolvedClaims = claims
        return { id: 77 } as User
      },
    })

    const session = await service.authenticateAuthorizationHeader(`Bearer ${token}`)

    assert.equal(session.user.id, 77)
    assert.equal(session.claims.sub, 'authnei-production-subject')
    assert.equal(session.claims.email, 'student@isep.ipp.pt')
    assert.deepEqual(session.claims.authNeiRoles, ['admin'])
    assert.equal(resolvedClaims?.sub, 'authnei-production-subject')
  })

  test('refreshes JWKS once when AuthNEI rotates to an unknown signing key', async ({ assert }) => {
    const issuer = env.get('AUTH_ISSUER_URL').replace(/\/+$/, '')
    const audience = env.get('AUTH_ALLOWED_AUDIENCES').split(',')[0].trim()
    const oldFixture = await signingFixture('old-key')
    const newFixture = await signingFixture('new-key')
    const token = await newFixture.sign({
      iss: issuer,
      sub: 'rotated-key-subject',
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: 'student@isep.ipp.pt',
      email_verified: true,
      name: 'Student',
    })
    let jwksRequests = 0
    const service = new ZitadelAuthService({
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.endsWith('/.well-known/openid-configuration')) {
          return Response.json({ issuer, jwks_uri: `${issuer}/oauth/v2/keys` })
        }
        if (url.endsWith('/oauth/v2/keys')) {
          jwksRequests += 1
          return Response.json({ keys: jwksRequests === 1 ? [oldFixture.jwk] : [newFixture.jwk] })
        }
        throw new Error(`Unexpected identity request: ${url}`)
      },
      resolveUser: async () => ({ id: 77 }) as User,
    })

    const session = await service.authenticateAuthorizationHeader(`Bearer ${token}`)

    assert.equal(session.claims.sub, 'rotated-key-subject')
    assert.equal(jwksRequests, 2)
  })

  test('fails closed for missing, malformed, and extra-part bearer credentials', async ({
    assert,
  }) => {
    const service = new ZitadelAuthService()

    await assert.rejects(
      () => service.authenticateAuthorizationHeader(undefined),
      UnauthorizedError
    )
    await assert.rejects(
      () => service.authenticateAuthorizationHeader('Bearer not-a-jwt'),
      UnauthorizedError
    )
    await assert.rejects(
      () => service.authenticateAuthorizationHeader('Bearer token unexpected'),
      UnauthorizedError
    )
  })

  test('rejects UserInfo belonging to a different AuthNEI subject', async ({ assert }) => {
    const issuer = env.get('AUTH_ISSUER_URL').replace(/\/+$/, '')
    const audience = env.get('AUTH_ALLOWED_AUDIENCES').split(',')[0].trim()
    const fixture = await signingFixture('subject-key')
    const token = await fixture.sign({
      iss: issuer,
      sub: 'access-token-subject',
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    const service = new ZitadelAuthService({
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.endsWith('/.well-known/openid-configuration')) {
          return Response.json({
            issuer,
            jwks_uri: `${issuer}/keys`,
            userinfo_endpoint: `${issuer}/userinfo`,
          })
        }
        if (url.endsWith('/keys')) return Response.json({ keys: [fixture.jwk] })
        return Response.json({
          sub: 'different-subject',
          email: 'student@isep.ipp.pt',
          email_verified: true,
          name: 'Student',
        })
      },
      resolveUser: async () => ({ id: 77 }) as User,
    })

    await assert.rejects(
      () => service.authenticateAuthorizationHeader(`Bearer ${token}`),
      'User profile subject mismatch'
    )
  })
})
