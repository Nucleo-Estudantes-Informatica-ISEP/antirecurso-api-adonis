import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import ZitadelAuthService from '#services/auth/zitadel_auth_service'
import AccountLinkPending from '#models/account_link_pending'
import User from '#models/user'
import { createOidcFixture, installFetchMock, userPayload, adminPayload } from '#tests/helpers/token_factory'

test.group('USER vs ADMIN authorization', (group) => {
  let userToken: string
  let adminToken: string
  let restoreFetch: () => void

  group.setup(async () => {
    ZitadelAuthService.clearCachesForTests()
    const fixture = await createOidcFixture()
    restoreFetch = installFetchMock(fixture.jwk)
    userToken = await fixture.sign(userPayload('authz-user-sub', 'authz-user@example.test'))
    adminToken = await fixture.sign(adminPayload('authz-admin-sub', 'authz-admin@example.test'))
  })

  group.teardown(() => {
    restoreFetch()
    ZitadelAuthService.clearCachesForTests()
  })

  test('regular user on admin-only route returns 403', async ({ client }) => {
    const res = await client.get('/admin').header('authorization', `Bearer ${userToken}`)
    res.assertStatus(403)
    res.assertBodyContains({ message: 'You are not an admin' })
  })

  test('regular user cannot list users', async ({ client }) => {
    const res = await client.get('/users').header('authorization', `Bearer ${userToken}`)
    res.assertStatus(403)
  })

  test('regular user cannot access admin exam stats', async ({ client }) => {
    const res = await client.get('/admin/exams').header('authorization', `Bearer ${userToken}`)
    res.assertStatus(403)
  })

  test('admin token on admin route is accepted', async ({ client }) => {
    const res = await client.get('/admin').header('authorization', `Bearer ${adminToken}`)
    res.assertStatus(200)
  })

  test('admin can list users', async ({ client, assert }) => {
    const res = await client.get('/users').header('authorization', `Bearer ${adminToken}`)
    res.assertStatus(200)
    assert.isArray(res.body().data)
  })

  test('admin can access exam stats', async ({ client }) => {
    const res = await client.get('/admin/exams').header('authorization', `Bearer ${adminToken}`)
    res.assertStatus(200)
  })
})

test.group('Pending-account restrictions', (group) => {
  let pendingToken: string
  let restoreFetch: () => void
  let pendingUser: User

  const PENDING_SUB = 'pending-account-sub'
  const PENDING_EMAIL = 'pending-account@example.test'
  const CONFLICTING_SUB = 'conflicting-sub'

  group.setup(async () => {
    ZitadelAuthService.clearCachesForTests()
    const fixture = await createOidcFixture()
    restoreFetch = installFetchMock(fixture.jwk)
    pendingToken = await fixture.sign(userPayload(PENDING_SUB, PENDING_EMAIL))

    // Create a user whose authSubject matches the token sub
    pendingUser = await User.create({
      authSubject: PENDING_SUB,
      email: PENDING_EMAIL,
      name: 'Pending User',
      emailVerifiedAt: DateTime.now(),
      password: 'oidc-managed:pending-test',
      isAdmin: false,
      rememberToken: null,
    })

    // Create a pending account link for this user (simulates a ZITADEL identity conflict)
    await AccountLinkPending.create({
      userId: pendingUser.id,
      authSubject: CONFLICTING_SUB,
    })
  })

  group.teardown(async () => {
    restoreFetch()
    ZitadelAuthService.clearCachesForTests()
    await AccountLinkPending.query().where('userId', pendingUser.id).delete()
    await pendingUser.delete()
  })

  test('pending account is blocked on regular protected routes', async ({ client }) => {
    const res = await client.get('/exams').header('authorization', `Bearer ${pendingToken}`)
    res.assertStatus(403)
    res.assertBodyContains({ requires_account_resolution: true })
  })

  test('pending account can still access GET /user', async ({ client }) => {
    const res = await client.get('/user').header('authorization', `Bearer ${pendingToken}`)
    res.assertStatus(200)
  })

  test('pending account can reach POST /user/account-resolution (validation fails, not auth)', async ({ client, assert }) => {
    const res = await client
      .post('/user/account-resolution')
      .header('authorization', `Bearer ${pendingToken}`)
      .json({})
    // Any 4xx other than 401/403 proves auth passed and the route is accessible.
    assert.notEqual(res.status(), 401)
    assert.notEqual(res.status(), 403)
  })
})
