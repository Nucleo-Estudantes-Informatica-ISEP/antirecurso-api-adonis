import { test } from '@japa/runner'
import { performAccountResolution } from '#services/auth/account_resolution_service'

test.group('Account resolution service', () => {
  test('updates the auth subject before deleting the recovery marker', async ({ assert }) => {
    const calls: string[] = []

    await performAccountResolution({
      deletePendingMarker: async () => {
        calls.push('delete-pending')
      },
      updateAuthSubject: async () => {
        calls.push('update-subject')
      },
    })

    assert.deepEqual(calls, ['update-subject', 'delete-pending'])
  })

  test('keeps the recovery marker when the subject update fails', async ({ assert }) => {
    let deletedPending = false

    await assert.rejects(
      () =>
        performAccountResolution({
          deletePendingMarker: async () => {
            deletedPending = true
          },
          updateAuthSubject: async () => {
            throw new Error('subject conflict')
          },
        }),
      'subject conflict'
    )

    assert.isFalse(deletedPending)
  })
})
