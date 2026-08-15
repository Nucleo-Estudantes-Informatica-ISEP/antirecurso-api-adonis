import { test } from '@japa/runner'
import { getAuthNeiRoles, hasAuthNeiRole } from '#services/auth/auth_nei_roles'

test.group('AuthNEI roles', () => {
  test('normalizes shared-project role object and filters unknown roles', ({ assert }) => {
    const roles = getAuthNeiRoles({
      'urn:zitadel:iam:org:project:roles': {
        student: { 'org-id': 'org-id' },
        admin: { 'org-id': 'org-id' },
        unsupported: { 'org-id': 'org-id' },
      },
    })

    assert.deepEqual(roles, ['student', 'admin'])
    assert.isTrue(hasAuthNeiRole({ authNeiRoles: roles }, 'admin'))
  })

  test('supports project-id claim variants and configured claims', ({ assert }) => {
    const roles = getAuthNeiRoles(
      {
        'urn:zitadel:iam:org:project:id:project-id:roles': ['employee'],
        'custom_roles': 'student,nei_member',
      },
      'custom_roles'
    )

    assert.deepEqual(roles, ['student', 'nei_member', 'employee'])
  })
})
