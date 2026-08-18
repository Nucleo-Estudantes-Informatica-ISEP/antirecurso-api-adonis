import { test } from '@japa/runner'
import { getRateLimitKey } from '#services/security/rate_limit_policy'

test.group('Rate limit policy', () => {
  test('uses stable authenticated-user keys', ({ assert }) => {
    assert.equal(getRateLimitKey(42, '203.0.113.10'), 'user:42')
  })

  test('falls back to the request IP for anonymous traffic', ({ assert }) => {
    assert.equal(getRateLimitKey(undefined, '203.0.113.10'), 'ip:203.0.113.10')
  })
})
