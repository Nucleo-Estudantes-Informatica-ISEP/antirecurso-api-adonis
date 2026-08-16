import { test } from '@japa/runner'
import { getHealthStatus } from '#services/health_service'

test.group('health contract', () => {
  test('reports the service as ready', ({ assert }) => {
    assert.deepEqual(getHealthStatus(), { status: 'ok' })
  })
})
