import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import ZitadelAuthService from '#services/auth/zitadel_auth_service'
import Subject from '#models/subject'
import QuestionType from '#models/question_type'
import Question from '#models/question'
import Option from '#models/option'
import { createOidcFixture, installFetchMock, userPayload, adminPayload } from '#tests/helpers/token_factory'

test.group('Exams', (group) => {
  const suffix = randomUUID().slice(0, 8)
  const USER_SUB = `exams-user-${suffix}`
  const USER_EMAIL = `exams-user-${suffix}@example.test`
  const ADMIN_SUB = `exams-admin-${suffix}`
  const ADMIN_EMAIL = `exams-admin-${suffix}@example.test`

  let userToken: string
  let adminToken: string
  let restoreFetch: () => void
  let subject: Subject
  let questions: Question[]

  group.setup(async () => {
    ZitadelAuthService.clearCachesForTests()
    const fixture = await createOidcFixture()
    restoreFetch = installFetchMock(fixture.jwk)
    userToken = await fixture.sign(userPayload(USER_SUB, USER_EMAIL))
    adminToken = await fixture.sign(adminPayload(ADMIN_SUB, ADMIN_EMAIL))

    subject = await Subject.create({
      name: `Exam Subject ${suffix}`,
      slug: `exam-subject-${suffix}`,
      year: 1,
    })
    const qType = await QuestionType.create({ name: 'MC', subjectId: subject.id })

    // DEFAULT_EXAM_RULE requires exactly 10 questions with minimum_options=2
    questions = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        Question.create({
          question: `Test question ${i + 1}?`,
          image: '',
          exam: '',
          correctOption: 'A',
          subjectId: subject.id,
          questionTypeId: qType.id,
        })
      )
    )
    for (const q of questions) {
      await Option.createMany([
        { name: 'Yes', order: 'A', questionId: q.id },
        { name: 'No', order: 'B', questionId: q.id },
      ])
    }
  })

  group.teardown(async () => {
    restoreFetch()
    ZitadelAuthService.clearCachesForTests()
    await Option.query().whereIn('questionId', questions.map((q) => q.id)).delete()
    await Question.query().where('subjectId', subject.id).delete()
    await QuestionType.query().where('subjectId', subject.id).delete()
    await subject.delete()
  })

  // --- Generation ---

  test('generate exam for unknown subject returns 404', async ({ client }) => {
    const res = await client.get('/exams/generate/999999')
    res.assertStatus(404)
  })

  test('generate default exam returns questions array', async ({ client, assert }) => {
    const res = await client.get(`/exams/generate/${subject.id}`)
    res.assertStatus(200)
    assert.isArray(res.body())
  })

  test('generate exam in mode requiring auth without token returns 401', async ({ client }) => {
    const res = await client.get(`/exams/generate/${subject.id}?mode=wrong`)
    res.assertStatus(401)
  })

  test('generate exam with valid token and auth-required mode is accepted', async ({ client, assert }) => {
    const res = await client
      .get(`/exams/generate/${subject.id}?mode=new`)
      .header('authorization', `Bearer ${userToken}`)
    // 200 with questions or 400 if not enough history — either means auth passed
    assert.notEqual(res.status(), 401)
    assert.notEqual(res.status(), 403)
  })

  // --- Verification ---

  test('verify with missing body returns 422', async ({ client }) => {
    const res = await client.post('/exams/verify').json({})
    res.assertStatus(422)
  })

  test('verify with valid payload returns result', async ({ client }) => {
    const res = await client.post('/exams/verify').json({
      subject_id: subject.id,
      mode: 'default',
      answers: questions.map((q) => ({ question_id: q.id, selected_option: 'A' })),
    })
    res.assertStatus(200)
  })

  test('verify with invalid subject returns 404', async ({ client }) => {
    const res = await client.post('/exams/verify').json({
      subject_id: 999999,
      answers: [{ question_id: 1 }],
    })
    res.assertStatus(404)
  })

  // --- History ---

  test('GET /exams without token returns 401', async ({ client }) => {
    const res = await client.get('/exams')
    res.assertStatus(401)
  })

  test('GET /exams returns paginated history', async ({ client, assert }) => {
    const res = await client.get('/exams').header('authorization', `Bearer ${userToken}`)
    res.assertStatus(200)
    assert.isArray(res.body().data)
    assert.exists(res.body().meta)
  })

  test('GET /exams/:id with unknown id returns 404', async ({ client }) => {
    const res = await client.get('/exams/999999').header('authorization', `Bearer ${userToken}`)
    res.assertStatus(404)
  })

  // --- Exam state ---

  test('GET /exams/state with no saved state returns null', async ({ client, assert }) => {
    const res = await client
      .get(`/exams/state?subject_id=${subject.id}&mode=default`)
      .header('authorization', `Bearer ${userToken}`)
    res.assertStatus(200)
    assert.isNull(res.body().state)
  })

  test('POST /exams/state with invalid state payload returns 400', async ({ client }) => {
    // auth passes, normalizeSavedExamState rejects the empty state → 400 not 401
    const res = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({ subject_id: subject.id, mode: 'default', state: {} })
    res.assertStatus(400)
  })

  test('DELETE /exams/state succeeds even when no state exists', async ({ client }) => {
    const res = await client
      .delete(`/exams/state?subject_id=${subject.id}&mode=default`)
      .header('authorization', `Bearer ${userToken}`)
    res.assertStatus(204)
  })

  // --- Pending exams ---

  test('GET /exams/pending returns empty list for new user', async ({ client, assert }) => {
    const res = await client.get('/exams/pending').header('authorization', `Bearer ${userToken}`)
    res.assertStatus(200)
    assert.isArray(res.body().data)
  })

  // --- Admin exam stats ---

  test('GET /admin/exams with user token returns 403', async ({ client }) => {
    const res = await client.get('/admin/exams').header('authorization', `Bearer ${userToken}`)
    res.assertStatus(403)
  })

  test('GET /admin/exams with admin token returns stats', async ({ client }) => {
    const res = await client.get('/admin/exams').header('authorization', `Bearer ${adminToken}`)
    res.assertStatus(200)
    res.assertBodyContains({ exams_per_day: [] })
  })
})
