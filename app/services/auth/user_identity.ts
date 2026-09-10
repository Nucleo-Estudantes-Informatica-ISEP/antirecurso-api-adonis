import { createHash } from 'node:crypto'
import type User from '#models/user'
import type { AuthClaims } from '#services/auth/zitadel_auth_service'
import { hasAuthNeiRole } from '#services/auth/auth_nei_roles'

type LocalIdentity = Pick<User, 'id' | 'name' | 'email'>

export function getUserAvatar(email: string, picture?: unknown): string {
  if (typeof picture === 'string' && picture.trim()) return picture

  return createHash('md5').update(email.trim().toLowerCase()).digest('hex')
}

export function serializeUserIdentity(user: LocalIdentity, claims?: AuthClaims) {
  const email = claims?.email ?? user.email
  const identity = {
    id: user.id,
    name: claims?.name ?? user.name,
    email,
    avatar: getUserAvatar(email, claims?.picture),
  }

  return claims ? { ...identity, is_admin: hasAuthNeiRole(claims, 'admin') } : identity
}
