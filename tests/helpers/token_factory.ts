import { webcrypto } from 'node:crypto'
import env from '#start/env'

const encoder = new TextEncoder()

export type OidcFixture = {
  jwk: Record<string, unknown>
  sign: (payload: Record<string, unknown>) => Promise<string>
}

/**
 * Generates an RSA keypair and returns a sign() function that produces
 * valid RS256 JWTs, plus the public JWK to serve from the JWKS mock endpoint.
 */
export async function createOidcFixture(kid = 'functional-test-key'): Promise<OidcFixture> {
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

  const rawJwk = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey)
  const jwk = { ...rawJwk, kid, alg: 'RS256', use: 'sig' }

  const sign = async (payload: Record<string, unknown>): Promise<string> => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })
    ).toString('base64url')
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const input = `${header}.${encodedPayload}`
    const sig = await webcrypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      keyPair.privateKey,
      encoder.encode(input)
    )
    return `${input}.${Buffer.from(sig).toString('base64url')}`
  }

  return { jwk, sign }
}

/**
 * Replaces globalThis.fetch so that OIDC discovery and JWKS requests are served
 * deterministically from the generated keypair. Returns a restore function to
 * call in group.teardown().
 */
export function installFetchMock(jwk: Record<string, unknown>): () => void {
  const issuer = env.get('AUTH_ISSUER_URL').replace(/\/+$/, '')
  const original = globalThis.fetch

  globalThis.fetch = async (request, init) => {
    const url = String(request)
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({ issuer, jwks_uri: `${issuer}/oauth/v2/keys` })
    }
    if (url === `${issuer}/oauth/v2/keys`) {
      return Response.json({ keys: [jwk] })
    }
    return original(request, init)
  }

  return () => {
    globalThis.fetch = original
  }
}

/**
 * Base payload for a regular authenticated user.
 * Includes all claims needed to skip UserInfo resolution.
 */
export function userPayload(
  sub: string,
  email: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const issuer = env.get('AUTH_ISSUER_URL').replace(/\/+$/, '')
  const audience = env.get('AUTH_ALLOWED_AUDIENCES').split(',')[0].trim()
  const roleClaim = env.get('AUTH_ROLE_CLAIM') ?? 'urn:zitadel:iam:org:project:roles'

  return {
    iss: issuer,
    sub,
    aud: [audience],
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    email,
    email_verified: true,
    name: 'Test User',
    [roleClaim]: {},
    ...overrides,
  }
}

/**
 * Sentinel stored in the password column for test users whose auth is
 * delegated entirely to OIDC — the value is never used for authentication.
 */
export const OIDC_TEST_SENTINEL = 'oidc-managed:functional-test'

/**
 * Payload for an admin user (carries the admin role in the configured claim).
 */
export function adminPayload(sub: string, email: string): Record<string, unknown> {
  const roleClaim = env.get('AUTH_ROLE_CLAIM') ?? 'urn:zitadel:iam:org:project:roles'
  return userPayload(sub, email, {
    name: 'Test Admin',
    [roleClaim]: { admin: {} },
  })
}
