import { createHash, webcrypto } from 'node:crypto'
import { DateTime } from 'luxon'
import env from '#start/env'
import User from '#models/user'
import AccountLinkPending from '#models/account_link_pending'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { accountSubjectHash } from '#services/auth/user_identity'
import { performAccountResolution } from '#services/auth/account_resolution_service'
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
  picture?: string
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

class AccountRecoveryRequiredError extends ForbiddenError {
  constructor() {
    super('Contact support to recover the existing account')
  }
}

const IDENTITY_DOCUMENT_TTL_MS = 5 * 60 * 1000
const IDENTITY_RETRY_MS = 30_000
const IDENTITY_TIMEOUT_MS = 5_000
const MAX_USERINFO_REQUESTS = 32

class IdentityDocument<T> {
  private cached?: { key: string; value: T; expiresAt: number }
  private pending?: Promise<T>
  private retryAt = 0

  read(key: string, load: () => Promise<T>, refresh = false): Promise<T> {
    const cached = this.cached?.key === key ? this.cached : undefined
    const now = Date.now()
    if (cached && cached.expiresAt > now && !refresh) {
      return Promise.resolve(cached.value)
    }
    if (this.pending) return this.pending
    if (now < this.retryAt) {
      if (cached && cached.expiresAt > now) return Promise.resolve(cached.value)
      return Promise.reject(new UnauthorizedError('Identity provider unavailable'))
    }

    if (refresh) this.retryAt = now + IDENTITY_RETRY_MS
    this.pending = load()
      .then((value) => {
        this.cached = { key, value, expiresAt: Date.now() + IDENTITY_DOCUMENT_TTL_MS }
        return value
      })
      .catch((error) => {
        this.retryAt = Date.now() + IDENTITY_RETRY_MS
        throw error
      })
      .finally(() => {
        this.pending = undefined
      })
    return this.pending
  }
}

function accessTokenHash(token: string) {
  return createHash('sha256')
    .update(token.slice(0, token.lastIndexOf('.')))
    .digest('hex')
}

async function isAccessTokenRevoked(token: string) {
  return Boolean(
    await db.from('revoked_access_tokens').where('token_hash', accessTokenHash(token)).first()
  )
}

type Fetch = typeof fetch
type ZitadelAuthServiceOptions = {
  fetchImpl?: Fetch
  resolveUser?: (claims: AuthClaims) => Promise<User>
  isRevoked?: (token: string) => Promise<boolean>
}

export default class ZitadelAuthService {
  private static discovery = new IdentityDocument<OpenIdConfiguration>()
  private static jwks = new IdentityDocument<JsonWebKeySet>()
  private static userInfoRequests = new Map<string, Promise<JwtPayload>>()

  private fetchImpl: Fetch
  private resolveUser?: (claims: AuthClaims) => Promise<User>
  private isRevoked: (token: string) => Promise<boolean>

  constructor(options: ZitadelAuthServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.resolveUser = options.resolveUser
    this.isRevoked = options.isRevoked ?? isAccessTokenRevoked
  }

  static clearCachesForTests() {
    ZitadelAuthService.discovery = new IdentityDocument<OpenIdConfiguration>()
    ZitadelAuthService.jwks = new IdentityDocument<JsonWebKeySet>()
    ZitadelAuthService.userInfoRequests.clear()
  }

  async authenticateAuthorizationHeader(
    authorizationHeader: string | undefined
  ): Promise<AuthSession> {
    const accessToken = this.extractBearerToken(authorizationHeader)
    const claims = await this.verifyAccessToken(accessToken)
    if (await this.isRevoked(accessToken)) throw new UnauthorizedError('Access token revoked')
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

  async revokeAuthorizationHeader(authorizationHeader: string | undefined) {
    const accessToken = this.extractBearerToken(authorizationHeader)
    const claims = await this.verifyAccessToken(accessToken)
    await db.transaction(async (trx) => {
      await trx
        .from('revoked_access_tokens')
        .where('expires_at', '<=', Math.floor(Date.now() / 1000))
        .delete()
      await trx
        .table('revoked_access_tokens')
        .insert({ token_hash: accessTokenHash(accessToken), expires_at: claims.exp })
        .onConflict('token_hash')
        .ignore()
    })
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
    const segments = accessToken.split('.')
    if (segments.length !== 3 || segments.some((segment) => !/^[a-zA-Z0-9_-]+$/.test(segment))) {
      throw new UnauthorizedError('Malformed access token')
    }
    const [encodedHeader, encodedPayload, encodedSignature] = segments
    const header = this.decodeBase64UrlJson<JwtHeader>(encodedHeader)
    const payload = this.decodeBase64UrlJson<JwtPayload>(encodedPayload)

    if (
      !header.alg ||
      !['RS256', 'RS384', 'RS512'].includes(header.alg) ||
      typeof header.kid !== 'string' ||
      !header.kid
    ) {
      throw new UnauthorizedError('Unsupported token header')
    }

    if (
      typeof payload.iss !== 'string' ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      payload.sub.length > 255 ||
      typeof payload.exp !== 'number' ||
      !Number.isSafeInteger(payload.exp) ||
      (payload.nbf !== undefined && !Number.isSafeInteger(payload.nbf)) ||
      (payload.iat !== undefined && !Number.isSafeInteger(payload.iat)) ||
      (typeof payload.aud !== 'string' &&
        !(Array.isArray(payload.aud) && payload.aud.every((aud) => typeof aud === 'string')))
    ) {
      throw new UnauthorizedError('Malformed access token claims')
    }

    const issuer = this.normalizeIssuer(env.get('AUTH_ISSUER_URL'))
    if (this.normalizeIssuer(payload.iss) !== issuer) {
      throw new UnauthorizedError('Token issuer mismatch')
    }

    const nowInSeconds = Math.floor(Date.now() / 1000)
    if (payload.exp <= nowInSeconds) {
      throw new UnauthorizedError('Access token expired')
    }

    if (payload.nbf !== undefined && payload.nbf > nowInSeconds) {
      throw new UnauthorizedError('Access token is not active yet')
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

        if (userinfo.sub !== payload.sub) {
          throw new UnauthorizedError('User profile subject mismatch')
        }

        email = email ?? (typeof userinfo.email === 'string' ? userinfo.email : undefined)
        const profileName = userinfo.name ?? userinfo.preferred_username
        name = name ?? (typeof profileName === 'string' ? profileName : undefined)
        mergedClaims = {
          ...userinfo,
          ...payload,
          email_verified: payload.email_verified ?? userinfo.email_verified,
        }
      }
    }

    if (!email || email.length > 255) {
      throw new UnauthorizedError('User email is missing from the identity provider response')
    }

    if (mergedClaims.email_verified !== true) {
      throw new UnauthorizedError('A verified identity-provider email is required')
    }

    if (env.get('AUTH_DEBUG')) {
      logger.info(
        {
          has_email: Boolean(email),
          has_name: Boolean(name ?? email.split('@')[0]),
          email_verified: mergedClaims.email_verified ?? null,
        },
        'identity claims resolved'
      )
    }

    return {
      ...mergedClaims,
      sub: payload.sub!,
      email,
      name: (name ?? email.split('@')[0]).slice(0, 255),
      authNeiRoles: getAuthNeiRoles(mergedClaims, roleClaim),
    }
  }

  private fetchUserInfo(userinfoEndpoint: string, accessToken: string): Promise<JwtPayload> {
    const requests = ZitadelAuthService.userInfoRequests
    const pending = requests.get(accessToken)
    if (pending) return pending
    if (requests.size >= MAX_USERINFO_REQUESTS) {
      throw new UnauthorizedError('Identity provider temporarily busy')
    }
    const request = this.fetchIdentityJson<JwtPayload>(userinfoEndpoint, accessToken).finally(
      () => {
        requests.delete(accessToken)
      }
    )
    requests.set(accessToken, request)
    return request
  }

  private async findOrCreateUser(claims: AuthClaims): Promise<User> {
    const hash = accountSubjectHash(claims.sub)
    const current = await User.query()
      .select('users.*', 'deleted_accounts.issued_before as deletion_cutoff')
      .leftJoin('deleted_accounts', 'deleted_accounts.subject_hash', db.raw('?', [hash]))
      .where('users.auth_subject', claims.sub)
      .first()
    if (current) {
      this.assertDeletionCutoff(claims, current.$extras.deletion_cutoff)
      if (current.email === claims.email && current.name === claims.name && current.emailVerifiedAt)
        return current
    }
    return db.transaction(async (trx) => {
      await trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', [hash])
      const deleted = await trx.from('deleted_accounts').where('subject_hash', hash).first()
      this.assertDeletionCutoff(claims, deleted?.issued_before)
      return this.resolveLocalUser(claims, trx)
    })
  }

  private assertDeletionCutoff(claims: AuthClaims, cutoff: unknown) {
    if (
      cutoff !== null &&
      cutoff !== undefined &&
      (!Number.isSafeInteger(claims.iat) || claims.iat! <= Number(cutoff))
    )
      throw new UnauthorizedError(
        'Account deleted; sign in again to create an empty AntiRecurso account'
      )
  }

  private async resolveLocalUser(
    claims: AuthClaims,
    trx: TransactionClientContract
  ): Promise<User> {
    const existingBySubject = await User.query()
      .useTransaction(trx)
      .where('authSubject', claims.sub)
      .first()
    if (existingBySubject) {
      existingBySubject.useTransaction(trx)
      existingBySubject.merge({
        email: claims.email,
        name: claims.name,
        emailVerifiedAt: existingBySubject.emailVerifiedAt ?? DateTime.now(),
      })
      await existingBySubject.save()
      return existingBySubject
    }

    const existingByEmail = await User.query()
      .useTransaction(trx)
      .where('email', claims.email)
      .forUpdate()
      .first()
    if (existingByEmail) {
      const approval =
        existingByEmail.authSubject === null
          ? await AccountLinkPending.query()
              .useTransaction(trx)
              .where('userId', existingByEmail.id)
              .where('authSubject', claims.sub)
              .whereNotNull('approvedAt')
              .forUpdate()
              .first()
          : null
      if (!approval) throw new AccountRecoveryRequiredError()

      existingByEmail.useTransaction(trx)
      existingByEmail.merge({
        authSubject: claims.sub,
        name: claims.name,
        emailVerifiedAt: existingByEmail.emailVerifiedAt ?? DateTime.now(),
      })
      await performAccountResolution({
        updateAuthSubject: async () => {
          await existingByEmail.save()
        },
        deletePendingMarker: () => approval.useTransaction(trx).delete(),
      })
      return existingByEmail
    }

    return User.create(
      {
        authSubject: claims.sub,
        email: claims.email,
        name: claims.name,
        emailVerifiedAt: DateTime.now(),
      },
      { client: trx }
    )
  }

  private decodeBase64UrlJson<T>(value: string): T {
    try {
      const document: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
      if (document === null || typeof document !== 'object' || Array.isArray(document)) {
        throw new Error()
      }
      return document as T
    } catch {
      throw new UnauthorizedError('Malformed token payload')
    }
  }

  private async fetchIdentityJson<T>(url: string, accessToken?: string): Promise<T> {
    try {
      const issuerOrigin = new URL(env.get('AUTH_ISSUER_URL')).origin
      const target = new URL(url)
      if (
        target.origin !== issuerOrigin ||
        target.username ||
        target.password ||
        !['https:', 'http:'].includes(target.protocol)
      ) {
        throw new Error()
      }
      const response = await this.fetchImpl(url, {
        headers: {
          accept: 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
        redirect: 'error',
      })
      if (!response.ok) throw new Error()
      const body: unknown = await response.json()
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error()
      return body as T
    } catch {
      throw new UnauthorizedError('Identity provider unavailable')
    }
  }

  private getDiscoveryDocument(): Promise<OpenIdConfiguration> {
    const issuer = this.normalizeIssuer(env.get('AUTH_ISSUER_URL'))
    return ZitadelAuthService.discovery.read(issuer, async () => {
      const document = await this.fetchIdentityJson<OpenIdConfiguration>(
        `${issuer}/.well-known/openid-configuration`
      )
      if (
        typeof document.issuer !== 'string' ||
        this.normalizeIssuer(document.issuer) !== issuer ||
        typeof document.jwks_uri !== 'string' ||
        (document.userinfo_endpoint !== undefined && typeof document.userinfo_endpoint !== 'string')
      ) {
        throw new UnauthorizedError('OIDC discovery issuer mismatch')
      }
      return document
    })
  }

  private getJwks(jwksUri: string, forceRefresh = false): Promise<JsonWebKeySet> {
    return ZitadelAuthService.jwks.read(
      jwksUri,
      async () => {
        const jwks = await this.fetchIdentityJson<JsonWebKeySet>(jwksUri)
        if (!Array.isArray(jwks.keys) || jwks.keys.some((key) => !key || typeof key !== 'object')) {
          throw new UnauthorizedError('Unable to load ZITADEL JWKS')
        }
        return jwks
      },
      forceRefresh
    )
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

export { AccountRecoveryRequiredError, ForbiddenError, UnauthorizedError }
