import { test } from '@japa/runner'

test.group('Public and health endpoints', () => {
  test('GET / returns health status', async ({ client }) => {
    const res = await client.get('/')
    res.assertStatus(200)
    res.assertBodyContains({ status: 'ok' })
  })

  test('GET /subjects returns an array', async ({ client, assert }) => {
    const res = await client.get('/subjects')
    res.assertStatus(200)
    assert.isArray(res.body())
  })

  test('GET /subjects/:id with unknown id returns 404', async ({ client }) => {
    const res = await client.get('/subjects/999999')
    res.assertStatus(404)
  })

  test('GET /questions/:id with unknown id returns 404', async ({ client }) => {
    const res = await client.get('/questions/999999')
    res.assertStatus(404)
  })

  test('GET /exams/generate/:id with unknown subject returns 404', async ({ client }) => {
    const res = await client.get('/exams/generate/999999')
    res.assertStatus(404)
  })

  test('GET /subjects/:id/scoreboard/:mode with unknown id returns 404', async ({ client }) => {
    const res = await client.get('/subjects/999999/scoreboard/all')
    res.assertStatus(404)
  })
})
