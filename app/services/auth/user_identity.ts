import { createHash } from 'node:crypto'
import type User from '#models/user'
import type { AuthClaims } from '#services/auth/zitadel_auth_service'
import { hasAuthNeiRole } from '#services/auth/auth_nei_roles'

type LocalIdentity = Pick<User, 'id' | 'name' | 'email'>

export function getUserAvatar(email: string): string {
  return createHash('md5').update(email.trim().toLowerCase()).digest('hex')
}

export function serializeUserIdentity(user: LocalIdentity, claims?: AuthClaims) {
  const email = claims?.email ?? user.email
  const picture = claims?.picture?.trim()
  const identity = {
    id: user.id,
    name: claims?.name ?? user.name,
    email,
    avatar: getUserAvatar(email),
    ...(picture ? { picture } : {}),
  }

  return claims ? { ...identity, is_admin: hasAuthNeiRole(claims, 'admin') } : identity
}
