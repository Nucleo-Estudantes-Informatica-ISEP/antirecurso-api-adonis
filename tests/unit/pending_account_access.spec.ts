import { test } from '@japa/runner'
import { canAccessWithPendingAccount } from '#services/auth/pending_account_access'

test.group('Pending account access', () => {
  test('allows only session and resolution endpoints for pending users', async ({ assert }) => {
    const lookupPending = async () => true

    assert.isTrue(
      await canAccessWithPendingAccount({ userId: 1, path: '/user', method: 'GET' }, lookupPending)
    )
    assert.isTrue(
      await canAccessWithPendingAccount(
        { userId: 1, path: '/user/account-resolution', method: 'POST' },
        lookupPending
      )
    )
    assert.isFalse(
      await canAccessWithPendingAccount({ userId: 1, path: '/exams', method: 'GET' }, lookupPending)
    )
  })

  test('propagates lookup failures instead of granting access', async ({ assert }) => {
    const lookupFailure = new Error('database unavailable')

    await assert.rejects(
      () =>
        canAccessWithPendingAccount({ userId: 1, path: '/exams', method: 'GET' }, async () => {
          throw lookupFailure
        }),
      'database unavailable'
    )
  })
})
