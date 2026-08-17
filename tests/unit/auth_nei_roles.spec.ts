import { test } from '@japa/runner'
import { getAuthNeiRoles, hasAuthNeiRole } from '#services/auth/auth_nei_roles'

test.group('AuthNEI roles', () => {
  test('normalizes AntiRecurso admin and filters unknown roles', ({ assert }) => {
    const roles = getAuthNeiRoles({
      'urn:zitadel:iam:org:project:roles': {
        admin: { 'org-id': 'org-id' },
        unsupported: { 'org-id': 'org-id' },
      },
    })

    assert.deepEqual(roles, ['admin'])
    assert.isTrue(hasAuthNeiRole({ authNeiRoles: roles }, 'admin'))
  })

  test('supports an explicitly configured AntiRecurso role claim', ({ assert }) => {
    const roles = getAuthNeiRoles(
      {
        custom_roles: 'admin',
      },
      'custom_roles'
    )

    assert.deepEqual(roles, ['admin'])
  })

  test('does not aggregate roles from another ZITADEL project', ({ assert }) => {
    const roles = getAuthNeiRoles({
      'urn:zitadel:iam:org:project:roles': {},
      'urn:zitadel:iam:org:project:id:orbit-project:roles': {
        admin: { 'org-id': 'org-id' },
        nei_member: { 'org-id': 'org-id' },
      },
    })

    assert.deepEqual(roles, [])
  })
})
