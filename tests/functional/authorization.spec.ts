import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import ZitadelAuthService from '#services/auth/zitadel_auth_service'
import AccountLinkPending from '#models/account_link_pending'
import User from '#models/user'
import Answer from '#models/answer'
import Question from '#models/question'
import QuestionReport from '#models/question_report'
import QuestionType from '#models/question_type'
import Score from '#models/score'
import Subject from '#models/subject'
import {
  createOidcFixture,
  installFetchMock,
  userPayload,
  adminPayload,
} from '#tests/helpers/token_factory'

test.group('USER vs ADMIN authorization', (group) => {
  const suffix = randomUUID().slice(0, 8)
  let userToken: string
  let adminToken: string
  let restoreFetch: () => void

  group.setup(async () => {
    ZitadelAuthService.clearCachesForTests()
    const fixture = await createOidcFixture()
    restoreFetch = installFetchMock(fixture.jwk)
    userToken = await fixture.sign(
      userPayload(`authz-user-${suffix}`, `authz-user-${suffix}@example.test`)
    )
    adminToken = await fixture.sign(
      adminPayload(`authz-admin-${suffix}`, `authz-admin-${suffix}@example.test`)
    )
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

test.group('Verified legacy account recovery', (group) => {
  let pendingToken: string
  let restoreFetch: () => void
  let pendingUser: User
  let originalToken: string
  let legacyAccount: User
  let unapprovedAccount: User
  let unapprovedToken: string
  let conflictingToken: string
  let subject: Subject
  let answer: Answer
  let score: Score
  let report: QuestionReport

  const suffix = randomUUID().slice(0, 8)
  const PENDING_SUB = `pending-account-sub-${suffix}`
  const PENDING_EMAIL = `pending-account-${suffix}@example.test`
  const CONFLICTING_SUB = `conflicting-sub-${suffix}`

  group.setup(async () => {
    ZitadelAuthService.clearCachesForTests()
    const fixture = await createOidcFixture()
    restoreFetch = installFetchMock(fixture.jwk)
    pendingToken = await fixture.sign(userPayload(PENDING_SUB, PENDING_EMAIL))
    conflictingToken = await fixture.sign(userPayload(`other-${PENDING_SUB}`, PENDING_EMAIL))

    originalToken = await fixture.sign(userPayload(CONFLICTING_SUB, `current-${PENDING_EMAIL}`))
    legacyAccount = await User.create({
      authSubject: CONFLICTING_SUB,
      email: `current-${PENDING_EMAIL}`,
      name: 'Current user',
    })
    pendingUser = await User.create({
      authSubject: null,
      email: PENDING_EMAIL,
      name: 'Pending User',
      emailVerifiedAt: DateTime.now(),
    })
    subject = await Subject.create({ name: suffix, slug: suffix, year: 1 })
    const type = await QuestionType.create({ name: 'MC', subjectId: subject.id })
    const question = await Question.create({
      question: 'Fixture question',
      correctOption: 'A',
      exam: '',
      image: '',
      subjectId: subject.id,
      questionTypeId: type.id,
    })
    answer = await Answer.create({
      userId: pendingUser.id,
      subjectId: subject.id,
      mode: 'default',
      score: 100,
    })
    score = await Score.create({
      userId: pendingUser.id,
      subjectId: subject.id,
      score: 100,
      showScoreboard: false,
    })
    report = await QuestionReport.create({ questionId: question.id, userId: pendingUser.id })

    const unapprovedEmail = `legacy-${PENDING_EMAIL}`
    const unapprovedSubject = `legacy-${PENDING_SUB}`
    unapprovedAccount = await User.create({
      authSubject: null,
      email: unapprovedEmail,
      name: 'Unapproved legacy user',
    })
    unapprovedToken = await fixture.sign(userPayload(unapprovedSubject, unapprovedEmail))
    await AccountLinkPending.create({
      userId: unapprovedAccount.id,
      authSubject: unapprovedSubject,
    })

    // A legacy recovery must be approved for the exact issuer subject.
    await AccountLinkPending.create({
      userId: pendingUser.id,
      authSubject: PENDING_SUB,
      approvedAt: DateTime.now(),
    })
    await AccountLinkPending.create({
      userId: legacyAccount.id,
      authSubject: `obsolete-${PENDING_SUB}`,
    })
  })

  group.teardown(async () => {
    restoreFetch()
    ZitadelAuthService.clearCachesForTests()
    await AccountLinkPending.query().where('userId', pendingUser.id).delete()
    await pendingUser.delete()
    await legacyAccount.delete()
    await unapprovedAccount.delete()
    await subject.delete()
  })

  test('only the approved subject can open existing history, including on concurrent requests', async ({
    client,
    assert,
  }) => {
    const denied = await client.get('/exams').header('authorization', `Bearer ${conflictingToken}`)
    denied.assertStatus(403)
    denied.assertBody({
      code: 'ACCOUNT_RECOVERY_REQUIRED',
      message: 'Contact support to recover the existing account',
    })

    const auth = `Bearer ${pendingToken}`
    const results = await Promise.all([
      client.get('/user/answers').header('authorization', auth),
      client.get('/user').header('authorization', auth),
    ])
    results.forEach((response) => response.assertStatus(200))
    assert.equal(results[0].body()[0].id, answer.id)
    assert.equal(results[1].body().requires_account_resolution, false)
    await pendingUser.refresh()
    assert.equal(pendingUser.authSubject, PENDING_SUB)
    assert.isNull(await AccountLinkPending.query().where('userId', pendingUser.id).first())
  })

  test('does not treat an unapproved legacy identity as authenticated on optional routes', async ({
    client,
  }) => {
    const res = await client
      .get('/exams/generate/999999')
      .header('authorization', `Bearer ${unapprovedToken}`)
    res.assertStatus(404)
  })

  test('an established identity can use its account and cannot act on stale recovery markers', async ({
    client,
    assert,
  }) => {
    const header = `Bearer ${originalToken}`
    const session = await client.get('/user').header('authorization', header)
    session.assertStatus(200)
    session.assertBodyContains({ requires_account_resolution: false })
    const resolve = await client
      .post('/user/account-resolution')
      .header('authorization', header)
      .json({ action: 'keep' })
    resolve.assertStatus(200)
    await legacyAccount.refresh()
    assert.equal(legacyAccount.authSubject, CONFLICTING_SUB)
  })

  test('repeated GET /user retains the same account', async ({ client, assert }) => {
    const res = await client.get('/user').header('authorization', `Bearer ${pendingToken}`)
    res.assertStatus(200)
    assert.equal(res.body().id, pendingUser.id)
  })

  test('the old discard action preserves exams, scores and reports', async ({ client, assert }) => {
    const res = await client
      .post('/user/account-resolution')
      .header('authorization', `Bearer ${pendingToken}`)
      .json({ action: 'discard' })
    res.assertStatus(400)
    const savedAnswer = await Answer.findOrFail(answer.id)
    assert.equal(savedAnswer.userId, pendingUser.id)
    const savedScore = await Score.findOrFail(score.id)
    assert.equal(savedScore.userId, pendingUser.id)
    const savedReport = await QuestionReport.findOrFail(report.id)
    assert.equal(savedReport.userId, pendingUser.id)
  })
  test('email verification alone does not approve legacy recovery', async ({ client, assert }) => {
    const session = await client.get('/user').header('authorization', `Bearer ${unapprovedToken}`)
    session.assertStatus(403)
    session.assertBodyContains({ code: 'ACCOUNT_RECOVERY_REQUIRED' })
    await unapprovedAccount.refresh()
    assert.isNull(unapprovedAccount.authSubject)
    assert.equal(unapprovedAccount.name, 'Unapproved legacy user')
  })

  test('supports repeated linking requests from older clients', async ({ client, assert }) => {
    const res = await client
      .post('/user/account-resolution')
      .header('authorization', `Bearer ${pendingToken}`)
      .json({ action: 'keep' })
    res.assertStatus(200)
    await pendingUser.refresh()
    assert.equal(pendingUser.authSubject, PENDING_SUB)
  })
})
