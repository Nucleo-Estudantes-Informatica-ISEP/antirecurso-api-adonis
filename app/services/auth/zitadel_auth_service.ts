import { randomUUID, webcrypto } from 'node:crypto'
import { DateTime } from 'luxon'
import env from '#start/env'
import User from '#models/user'
import { getAuthNeiRoles, type AuthNeiRole } from '#services/auth/auth_nei_roles'

type JsonWebKey = {
  alg?: string
  e?: string
  ext?: boolean
  kid?: string
  kty?: string
  n?: string
  use?: string
}

type JsonWebKeySet = {
  keys: JsonWebKey[]
}

type OpenIdConfiguration = {
  issuer: string
  jwks_uri: string
  userinfo_endpoint?: string
}

type JwtHeader = {
  alg?: string
  kid?: string
  typ?: string
}

type JwtPayload = {
  aud?: string | string[]
  email?: string
  email_verified?: boolean
  exp?: number
  iat?: number
  iss?: string
  name?: string
  preferred_username?: string
  scope?: string | string[]
  sub?: string
  nbf?: number
  [key: string]: unknown
}

export type AuthClaims = JwtPayload & {
  sub: string
  email: string
  name: string
  authNeiRoles: AuthNeiRole[]
}

export type AuthSession = {
  accessToken: string
  claims: AuthClaims
  user: User
}

class UnauthorizedError extends Error {
  status = 401

  constructor(message: string) {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

class ForbiddenError extends Error {
  status = 403

  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000

type Fetch = typeof fetch

type ZitadelAuthServiceOptions = {
  fetchImpl?: Fetch
  resolveUser?: (claims: AuthClaims) => Promise<User>
}

export default class ZitadelAuthService {
  private static discoveryCache:
    | {
        expiresAt: number
        issuer: string
        value: OpenIdConfiguration
      }
    | undefined

  private static jwksCache:
    | {
        expiresAt: number
        jwksUri: string
        value: JsonWebKeySet
      }
    | undefined

  private fetchImpl: Fetch
  private resolveUser?: (claims: AuthClaims) => Promise<User>

  constructor(options: ZitadelAuthServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.resolveUser = options.resolveUser
  }

  static clearCachesForTests() {
    ZitadelAuthService.discoveryCache = undefined
    ZitadelAuthService.jwksCache = undefined
  }

  async authenticateAuthorizationHeader(
    authorizationHeader: string | undefined
  ): Promise<AuthSession> {
    const accessToken = this.extractBearerToken(authorizationHeader)
    const claims = await this.verifyAccessToken(accessToken)
    const completeClaims = await this.resolveClaims(accessToken, claims)
    const user = this.resolveUser
      ? await this.resolveUser(completeClaims)
      : await this.findOrCreateUser(completeClaims)

    return {
      accessToken,
      claims: completeClaims,
      user,
    }
  }

  private extractBearerToken(authorizationHeader: string | undefined): string {
    if (!authorizationHeader) {
      throw new UnauthorizedError('Authentication required')
    }

    const parts = authorizationHeader.trim().split(/\s+/)
    const [scheme, token] = parts
    if (parts.length !== 2 || scheme !== 'Bearer' || !token) {
      throw new UnauthorizedError('Invalid authorization header')
    }

    return token
  }

  private async verifyAccessToken(accessToken: string): Promise<JwtPayload> {
    const [encodedHeader, encodedPayload, encodedSignature] = accessToken.split('.')

    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new UnauthorizedError('Malformed access token')
    }

    const header = this.decodeBase64UrlJson<JwtHeader>(encodedHeader)
    const payload = this.decodeBase64UrlJson<JwtPayload>(encodedPayload)

    if (env.get('AUTH_DEBUG')) {
      console.info('[auth][api-token]', {
        hasKid: Boolean(header.kid),
        alg: header.alg ?? null,
        issuer: payload.iss ?? null,
        audience: payload.aud ?? null,
        subject: payload.sub ?? null,
        hasEmail: typeof payload.email === 'string',
        hasName: typeof payload.name === 'string',
        exp: payload.exp ?? null,
      })
    }

    if (!header.alg || !header.kid || !['RS256', 'RS384', 'RS512'].includes(header.alg)) {
      throw new UnauthorizedError('Unsupported token header')
    }

    const issuer = this.normalizeIssuer(env.get('AUTH_ISSUER_URL'))
    if (!payload.iss || this.normalizeIssuer(payload.iss) !== issuer) {
      throw new UnauthorizedError('Token issuer mismatch')
    }

    const nowInSeconds = Math.floor(Date.now() / 1000)
    if (!payload.exp || payload.exp <= nowInSeconds) {
      throw new UnauthorizedError('Access token expired')
    }

    if (payload.nbf && payload.nbf > nowInSeconds) {
      throw new UnauthorizedError('Access token is not active yet')
    }

    if (!payload.sub) {
      throw new UnauthorizedError('Token subject is missing')
    }

    this.assertAudience(payload)

    const discovery = await this.getDiscoveryDocument()
    const jwks = await this.getJwks(discovery.jwks_uri)
    let signingKey = jwks.keys.find((key) => key.kid === header.kid)

    // A new signing key may appear before the five-minute cache expires.
    // Refresh once for an unknown kid so normal AuthNEI key rotation does not
    // reject otherwise valid production tokens.
    if (!signingKey) {
      const refreshedJwks = await this.getJwks(discovery.jwks_uri, true)
      signingKey = refreshedJwks.keys.find((key) => key.kid === header.kid)
    }

    if (!signingKey) {
      throw new UnauthorizedError('Unable to resolve token signing key')
    }

    const cryptoKey = await this.importSigningKey(signingKey, header.alg)
    const isValid = await webcrypto.subtle.verify(
      this.getAlgorithm(header.alg),
      cryptoKey,
      Buffer.from(encodedSignature, 'base64url'),
      Buffer.from(`${encodedHeader}.${encodedPayload}`)
    )

    if (!isValid) {
      throw new UnauthorizedError('Invalid access token signature')
    }

    return payload
  }

  private assertAudience(payload: JwtPayload) {
    const configuredAudiences = env
      .get('AUTH_ALLOWED_AUDIENCES')
      .split(',')
      .map((audience) => audience.trim())
      .filter(Boolean)

    if (!configuredAudiences.length) {
      throw new UnauthorizedError('Token audience validation is not configured')
    }

    const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : []
    const hasAllowedAudience = configuredAudiences.some((audience) => audiences.includes(audience))

    if (!hasAllowedAudience) {
      throw new UnauthorizedError('Token audience mismatch')
    }
  }

  private async resolveClaims(accessToken: string, payload: JwtPayload): Promise<AuthClaims> {
    let email = typeof payload.email === 'string' ? payload.email : undefined
    let name = typeof payload.name === 'string' ? payload.name : undefined
    let mergedClaims: JwtPayload = payload
    const roleClaim = env.get('AUTH_ROLE_CLAIM') ?? 'urn:zitadel:iam:org:project:roles'
    const hasRoleClaim = Object.prototype.hasOwnProperty.call(payload, roleClaim)

    if (!email || !name || payload.email_verified === undefined || !hasRoleClaim) {
      const discovery = await this.getDiscoveryDocument()

      if (discovery.userinfo_endpoint) {
        const userinfo = await this.fetchUserInfo(discovery.userinfo_endpoint, accessToken)

        if (userinfo.sub && userinfo.sub !== payload.sub) {
          throw new UnauthorizedError('User profile subject mismatch')
        }

        email = email ?? userinfo.email
        name = name ?? userinfo.name ?? userinfo.preferred_username
        mergedClaims = {
          ...userinfo,
          ...payload,
          email_verified: payload.email_verified ?? userinfo.email_verified,
        }
      }
    }

    if (!email) {
      throw new UnauthorizedError('User email is missing from the identity provider response')
    }

    if (mergedClaims.email_verified !== true) {
      throw new UnauthorizedError('A verified identity-provider email is required')
    }

    if (env.get('AUTH_DEBUG')) {
      console.info('[auth][api-claims]', {
        subject: payload.sub ?? null,
        hasEmail: Boolean(email),
        hasName: Boolean(name ?? email.split('@')[0]),
        emailVerified: mergedClaims.email_verified ?? null,
      })
    }

    return {
      ...mergedClaims,
      sub: payload.sub!,
      email,
      name: name ?? email.split('@')[0],
      authNeiRoles: getAuthNeiRoles(mergedClaims, roleClaim),
    }
  }

  private async fetchUserInfo(userinfoEndpoint: string, accessToken: string): Promise<JwtPayload> {
    const response = await this.fetchImpl(userinfoEndpoint, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      throw new UnauthorizedError('Unable to fetch user profile from ZITADEL')
    }

    return (await response.json()) as JwtPayload
  }

  private async findOrCreateUser(claims: AuthClaims): Promise<User> {
    const existingBySubject = await User.findBy('authSubject', claims.sub)
    if (existingBySubject) {
      existingBySubject.merge({
        email: claims.email,
        name: claims.name,
        emailVerifiedAt: existingBySubject.emailVerifiedAt ?? DateTime.now(),
      })
      await existingBySubject.save()
      return existingBySubject
    }

    const existingByEmail = await User.findBy('email', claims.email)
    if (existingByEmail) {
      if (existingByEmail.authSubject === claims.sub) {
        existingByEmail.merge({
          name: claims.name,
          emailVerifiedAt: existingByEmail.emailVerifiedAt ?? DateTime.now(),
        })
        await existingByEmail.save()
        return existingByEmail
      }

      const { default: AccountLinkPending } = await import('#models/account_link_pending')
      const existingPending = await AccountLinkPending.findBy('userId', existingByEmail.id)
      if (!existingPending) {
        await AccountLinkPending.create({
          userId: existingByEmail.id,
          authSubject: claims.sub,
        })
      }

      existingByEmail.merge({
        email: claims.email,
        name: claims.name,
        emailVerifiedAt: existingByEmail.emailVerifiedAt ?? DateTime.now(),
      })
      await existingByEmail.save()
      return existingByEmail
    }

    return User.create({
      authSubject: claims.sub,
      email: claims.email,
      name: claims.name,
      emailVerifiedAt: DateTime.now(),
      password: `oidc-managed:${randomUUID()}`,
      isAdmin: false,
      rememberToken: null,
    })
  }

  private decodeBase64UrlJson<T>(value: string): T {
    try {
      return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T
    } catch {
      throw new UnauthorizedError('Malformed token payload')
    }
  }

  private async getDiscoveryDocument(): Promise<OpenIdConfiguration> {
    const issuer = this.normalizeIssuer(env.get('AUTH_ISSUER_URL'))
    if (
      ZitadelAuthService.discoveryCache &&
      ZitadelAuthService.discoveryCache.expiresAt > Date.now() &&
      ZitadelAuthService.discoveryCache.issuer === issuer
    ) {
      return ZitadelAuthService.discoveryCache.value
    }

    const response = await this.fetchImpl(`${issuer}/.well-known/openid-configuration`, {
      headers: {
        accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new UnauthorizedError('Unable to load ZITADEL discovery document')
    }

    const document = (await response.json()) as OpenIdConfiguration
    if (
      typeof document.issuer !== 'string' ||
      typeof document.jwks_uri !== 'string' ||
      this.normalizeIssuer(document.issuer) !== issuer
    ) {
      throw new UnauthorizedError('OIDC discovery issuer mismatch')
    }
    ZitadelAuthService.discoveryCache = {
      expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
      issuer,
      value: document,
    }

    return document
  }

  private async getJwks(jwksUri: string, forceRefresh = false): Promise<JsonWebKeySet> {
    if (
      !forceRefresh &&
      ZitadelAuthService.jwksCache &&
      ZitadelAuthService.jwksCache.expiresAt > Date.now() &&
      ZitadelAuthService.jwksCache.jwksUri === jwksUri
    ) {
      return ZitadelAuthService.jwksCache.value
    }

    const response = await this.fetchImpl(jwksUri, {
      headers: {
        accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new UnauthorizedError('Unable to load ZITADEL JWKS')
    }

    const jwks = (await response.json()) as JsonWebKeySet
    ZitadelAuthService.jwksCache = {
      expiresAt: Date.now() + JWKS_CACHE_TTL_MS,
      jwksUri,
      value: jwks,
    }

    return jwks
  }

  private async importSigningKey(signingKey: JsonWebKey, alg: string) {
    if (signingKey.kty !== 'RSA') {
      throw new UnauthorizedError('Unsupported signing key type')
    }

    return webcrypto.subtle.importKey(
      'jwk',
      {
        ...signingKey,
        alg,
        ext: true,
      },
      this.getAlgorithm(alg),
      false,
      ['verify']
    )
  }

  private getAlgorithm(alg: string) {
    const hash: 'SHA-256' | 'SHA-384' | 'SHA-512' =
      alg === 'RS512' ? 'SHA-512' : alg === 'RS384' ? 'SHA-384' : 'SHA-256'

    return {
      name: 'RSASSA-PKCS1-v1_5' as const,
      hash,
    }
  }

  private normalizeIssuer(issuer: string) {
    return issuer.replace(/\/+$/, '')
  }
}

export { ForbiddenError, UnauthorizedError }
