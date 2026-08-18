export const AUTH_NEI_ROLES = ['admin'] as const

export type AuthNeiRole = (typeof AUTH_NEI_ROLES)[number]

const ROLE_SET = new Set<string>(AUTH_NEI_ROLES)
const DEFAULT_ROLE_CLAIM = 'urn:zitadel:iam:org:project:roles'

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

  // When a project-specific claim is configured, only that claim may grant
  // application privileges. This prevents an admin role from another ZITADEL
  // project (or the legacy generic claim) from being accepted accidentally.
  const roles = new Set<AuthNeiRole>()
  for (const role of rolesFromValue(claims[configuredClaim])) {
    if (ROLE_SET.has(role)) roles.add(role as AuthNeiRole)
  }

  return AUTH_NEI_ROLES.filter((role) => roles.has(role))
}

export function hasAuthNeiRole(
  claims: { authNeiRoles?: readonly AuthNeiRole[] } | undefined,
  role: AuthNeiRole
) {
  return claims?.authNeiRoles?.includes(role) ?? false
}
