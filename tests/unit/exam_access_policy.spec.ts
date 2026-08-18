import { test } from '@japa/runner'
import { canViewExamAttempt } from '#services/exams/exam_access_policy'

test.group('Exam access policy', () => {
  test('allows the owner and an administrator', ({ assert }) => {
    assert.isTrue(canViewExamAttempt({ authenticatedUserId: 12, ownerUserId: 12, isAdmin: false }))
    assert.isTrue(canViewExamAttempt({ authenticatedUserId: 99, ownerUserId: 12, isAdmin: true }))
  })

  test('denies other users and anonymous attempts', ({ assert }) => {
    assert.isFalse(canViewExamAttempt({ authenticatedUserId: 13, ownerUserId: 12, isAdmin: false }))
    assert.isFalse(
      canViewExamAttempt({ authenticatedUserId: 13, ownerUserId: null, isAdmin: false })
    )
  })
})
