import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import ZitadelAuthService from '#services/auth/zitadel_auth_service'
import { createOidcFixture, installFetchMock, userPayload } from '#tests/helpers/token_factory'

test.group('User profile endpoints', (group) => {
  const suffix = randomUUID().slice(0, 8)
  const USER_SUB = `profile-user-${suffix}`
  const USER_EMAIL = `profile-user-${suffix}@example.test`

  let userToken: string
  let restoreFetch: () => void

  group.setup(async () => {
    ZitadelAuthService.clearCachesForTests()
    const fixture = await createOidcFixture()
    restoreFetch = installFetchMock(fixture.jwk)
    userToken = await fixture.sign(userPayload(USER_SUB, USER_EMAIL))
  })

  group.teardown(() => {
    restoreFetch()
    ZitadelAuthService.clearCachesForTests()
  })

  // --- Profile ---

  test('GET /user without token returns 401', async ({ client }) => {
    const res = await client.get('/user')
    res.assertStatus(401)
  })

  test('GET /user returns current user profile', async ({ client, assert }) => {
    const res = await client.get('/user').header('authorization', `Bearer ${userToken}`)
    res.assertStatus(200)
    assert.equal(res.body().email, USER_EMAIL)
    assert.equal(res.body().requires_account_resolution, false)
  })

  // --- Scores ---

  test('GET /user/scores without token returns 401', async ({ client }) => {
    const res = await client.get('/user/scores')
    res.assertStatus(401)
  })

  test('GET /user/scores returns scores array', async ({ client, assert }) => {
    const res = await client.get('/user/scores').header('authorization', `Bearer ${userToken}`)
    res.assertStatus(200)
    assert.isArray(res.body())
  })

  // --- Answers history ---

  test('GET /user/answers without token returns 401', async ({ client }) => {
    const res = await client.get('/user/answers')
    res.assertStatus(401)
  })

  test('GET /user/answers returns answers array', async ({ client, assert }) => {
    const res = await client.get('/user/answers').header('authorization', `Bearer ${userToken}`)
    res.assertStatus(200)
    assert.isArray(res.body())
  })
})
