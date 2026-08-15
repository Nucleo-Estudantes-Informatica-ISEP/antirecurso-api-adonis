export const AUTH_NEI_ROLES = ['student', 'nei_member', 'admin', 'employee'] as const

export type AuthNeiRole = (typeof AUTH_NEI_ROLES)[number]

const ROLE_SET = new Set<string>(AUTH_NEI_ROLES)
const DEFAULT_ROLE_CLAIM = 'urn:zitadel:iam:org:project:roles'
const ZITADEL_PROJECT_ROLE_CLAIM = /^urn:zitadel:iam:org:project(?::id:[^:]+)?:roles$/

function rolesFromValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((role): role is string => typeof role === 'string')
  }

  if (typeof value === 'string') {
    return value.split(/[\s,]+/)
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
  }

  return []
}

export function getAuthNeiRoles(
  claims: Record<string, unknown> | undefined,
  configuredClaim = DEFAULT_ROLE_CLAIM
): AuthNeiRole[] {
  if (!claims) return []

  const claimKeys = new Set([
    configuredClaim,
    DEFAULT_ROLE_CLAIM,
    ...Object.keys(claims).filter((key) => ZITADEL_PROJECT_ROLE_CLAIM.test(key)),
  ])

  const roles = new Set<AuthNeiRole>()
  for (const key of claimKeys) {
    for (const role of rolesFromValue(claims[key])) {
      if (ROLE_SET.has(role)) roles.add(role as AuthNeiRole)
    }
  }

  return AUTH_NEI_ROLES.filter((role) => roles.has(role))
}

export function hasAuthNeiRole(
  claims: { authNeiRoles?: readonly AuthNeiRole[] } | undefined,
  role: AuthNeiRole
) {
  return claims?.authNeiRoles?.includes(role) ?? false
}
