import { test } from '@japa/runner'
import { canAccessWithPendingAccount } from '#services/auth/pending_account_access'

test.group('Pending account access', () => {
  test('allows only session and resolution endpoints for pending users', ({ assert }) => {
    assert.isTrue(canAccessWithPendingAccount({ pending: true, path: '/user', method: 'GET' }))
    assert.isTrue(
      canAccessWithPendingAccount({
        pending: true,
        path: '/user/account-resolution',
        method: 'POST',
      })
    )
    assert.isFalse(canAccessWithPendingAccount({ pending: true, path: '/exams', method: 'GET' }))
  })

  test('does not restrict established accounts', ({ assert }) => {
    assert.isTrue(canAccessWithPendingAccount({ pending: false, path: '/exams', method: 'GET' }))
  })
})
