import { randomUUID, webcrypto } from 'node:crypto'
import env from '#start/env'
import User from '#models/user'

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
  sub?: string
  [key: string]: unknown
}

export type AuthClaims = JwtPayload & {
  sub: string
  email: string
  name: string
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

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000

export default class ZitadelAuthService {
  private static discoveryCache:
    | {
        expiresAt: number
        value: OpenIdConfiguration
      }
    | undefined

  private static jwksCache:
    | {
        expiresAt: number
        value: JsonWebKeySet
      }
    | undefined

  async authenticateAuthorizationHeader(
    authorizationHeader: string | undefined
  ): Promise<AuthSession> {
    const accessToken = this.extractBearerToken(authorizationHeader)
    const claims = await this.verifyAccessToken(accessToken)
    const completeClaims = await this.resolveClaims(accessToken, claims)
    const user = await this.findOrCreateUser(completeClaims)

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

    const [scheme, token] = authorizationHeader.split(' ')
    if (scheme !== 'Bearer' || !token) {
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

    if (!header.alg || !header.kid) {
      throw new UnauthorizedError('Unsupported token header')
    }

    const issuer = env.get('AUTH_ISSUER_URL')
    if (payload.iss !== issuer) {
      throw new UnauthorizedError('Token issuer mismatch')
    }

    const nowInSeconds = Math.floor(Date.now() / 1000)
    if (!payload.exp || payload.exp <= nowInSeconds) {
      throw new UnauthorizedError('Access token expired')
    }

    if (!payload.sub) {
      throw new UnauthorizedError('Token subject is missing')
    }

    this.assertAudience(payload)

    const discovery = await this.getDiscoveryDocument()
    const jwks = await this.getJwks(discovery.jwks_uri)
    const signingKey = jwks.keys.find((key) => key.kid === header.kid)

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
      ?.split(',')
      .map((audience) => audience.trim())
      .filter(Boolean)

    if (!configuredAudiences?.length) {
      return
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

    if (!email || !name) {
      const discovery = await this.getDiscoveryDocument()

      if (discovery.userinfo_endpoint) {
        const userinfo = await this.fetchUserInfo(discovery.userinfo_endpoint, accessToken)

        email = email ?? userinfo.email
        name = name ?? userinfo.name ?? userinfo.preferred_username
      }
    }

    if (!email) {
      throw new UnauthorizedError('User email is missing from the identity provider response')
    }

    return {
      ...payload,
      sub: payload.sub!,
      email,
      name: name ?? email.split('@')[0],
    }
  }

  private async fetchUserInfo(
    userinfoEndpoint: string,
    accessToken: string
  ): Promise<Pick<AuthClaims, 'email' | 'name'> & { preferred_username?: string }> {
    const response = await fetch(userinfoEndpoint, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      throw new UnauthorizedError('Unable to fetch user profile from ZITADEL')
    }

    const data = (await response.json()) as {
      email?: string
      name?: string
      preferred_username?: string
    }

    return {
      email: data.email ?? '',
      name: data.name,
      preferred_username: data.preferred_username,
    }
  }

  private async findOrCreateUser(claims: AuthClaims): Promise<User> {
    const existingBySubject = await User.findBy('authSubject', claims.sub)
    if (existingBySubject) {
      existingBySubject.merge({
        email: claims.email,
        name: claims.name,
        emailVerifiedAt: claims.email_verified ? new Date() : existingBySubject.emailVerifiedAt,
      })
      await existingBySubject.save()
      return existingBySubject
    }

    const existingByEmail = await User.findBy('email', claims.email)
    if (existingByEmail && !existingByEmail.authSubject) {
      existingByEmail.merge({
        authSubject: claims.sub,
        name: claims.name,
        emailVerifiedAt: claims.email_verified ? new Date() : existingByEmail.emailVerifiedAt,
      })
      await existingByEmail.save()
      return existingByEmail
    }

    return User.create({
      authSubject: claims.sub,
      email: claims.email,
      name: claims.name,
      emailVerifiedAt: claims.email_verified ? new Date() : null,
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
    if (
      ZitadelAuthService.discoveryCache &&
      ZitadelAuthService.discoveryCache.expiresAt > Date.now()
    ) {
      return ZitadelAuthService.discoveryCache.value
    }

    const issuer = env.get('AUTH_ISSUER_URL').replace(/\/$/, '')
    const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
      headers: {
        accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new UnauthorizedError('Unable to load ZITADEL discovery document')
    }

    const document = (await response.json()) as OpenIdConfiguration
    ZitadelAuthService.discoveryCache = {
      expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
      value: document,
    }

    return document
  }

  private async getJwks(jwksUri: string): Promise<JsonWebKeySet> {
    if (ZitadelAuthService.jwksCache && ZitadelAuthService.jwksCache.expiresAt > Date.now()) {
      return ZitadelAuthService.jwksCache.value
    }

    const response = await fetch(jwksUri, {
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

  private getAlgorithm(alg: string): RsaHashedImportParams {
    const hash =
      alg === 'RS512' ? 'SHA-512' : alg === 'RS384' ? 'SHA-384' : 'SHA-256'

    return {
      name: 'RSASSA-PKCS1-v1_5',
      hash,
    }
  }
}

export { UnauthorizedError }
