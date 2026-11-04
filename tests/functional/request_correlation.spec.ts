import { test } from '@japa/runner'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

test.group('Request correlation headers', () => {
  test('echoes a well-formed client request ID', async ({ client, assert }) => {
    const res = await client.get('/').header('x-request-id', 'web-7f3a9c1e-42')

    res.assertStatus(200)
    assert.equal(res.header('x-request-id'), 'web-7f3a9c1e-42')
  })

  test('generates a request ID when the client sends none', async ({ client, assert }) => {
    const res = await client.get('/')

    assert.match(res.header('x-request-id') ?? '', UUID_PATTERN)
  })

  test('replaces an unsafe client request ID', async ({ client, assert }) => {
    const res = await client.get('/').header('x-request-id', 'short')

    assert.notEqual(res.header('x-request-id'), 'short')
    assert.match(res.header('x-request-id') ?? '', UUID_PATTERN)
  })

  test('returns a request ID on error responses', async ({ client, assert }) => {
    const res = await client.get('/subjects/999999').header('x-request-id', 'web-7f3a9c1e-43')

    res.assertStatus(404)
    assert.equal(res.header('x-request-id'), 'web-7f3a9c1e-43')
  })

  test('lets allowed browser origins send and read the request ID', async ({ client, assert }) => {
    const res = await client
      .options('/subjects')
      .header('origin', 'http://localhost:3000')
      .header('access-control-request-headers', 'x-request-id')

    res.assertStatus(204)
    assert.include(res.header('access-control-allow-headers'), 'X-Request-Id')
    assert.equal(res.header('access-control-expose-headers'), 'X-Request-Id')
    assert.match(res.header('x-request-id') ?? '', UUID_PATTERN)
  })
})
