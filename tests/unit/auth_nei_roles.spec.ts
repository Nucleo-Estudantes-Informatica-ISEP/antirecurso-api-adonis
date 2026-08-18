import { test } from '@japa/runner'
import { getAuthNeiRoles, hasAuthNeiRole } from '#services/auth/auth_nei_roles'

test.group('AuthNEI roles', () => {
  test('normalizes the generic admin claim when no override is configured', ({ assert }) => {
    const roles = getAuthNeiRoles({
      'urn:zitadel:iam:org:project:roles': {
        admin: { 'org-id': 'org-id' },
        unsupported: { 'org-id': 'org-id' },
      },
    })

    assert.deepEqual(roles, ['admin'])
    assert.isTrue(hasAuthNeiRole({ authNeiRoles: roles }, 'admin'))
  })

  test('reads admin from an explicitly configured global project claim', ({ assert }) => {
    const globalClaim = 'urn:zitadel:iam:org:project:nei-global-project:roles'
    const roles = getAuthNeiRoles(
      {
        [globalClaim]: {
          admin: { 'org-id': 'org-id' },
        },
      },
      globalClaim
    )

    assert.deepEqual(roles, ['admin'])
  })

  test('does not fall back to generic or other project claims when a global claim is configured', ({
    assert,
  }) => {
    const globalClaim = 'urn:zitadel:iam:org:project:nei-global-project:roles'
    const roles = getAuthNeiRoles(
      {
        'urn:zitadel:iam:org:project:roles': {
          admin: { 'org-id': 'org-id' },
        },
        'urn:zitadel:iam:org:project:orbit-project:roles': {
          admin: { 'org-id': 'org-id' },
        },
      },
      globalClaim
    )

    assert.deepEqual(roles, [])
  })
})
