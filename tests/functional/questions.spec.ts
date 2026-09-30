import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import ZitadelAuthService from '#services/auth/zitadel_auth_service'
import Subject from '#models/subject'
import QuestionType from '#models/question_type'
import Question from '#models/question'
import Option from '#models/option'
import {
  createOidcFixture,
  installFetchMock,
  userPayload,
  adminPayload,
} from '#tests/helpers/token_factory'

test.group('Questions source', (group) => {
  const suffix = randomUUID().slice(0, 8)
  const USER_SUB = `questions-user-${suffix}`
  const USER_EMAIL = `questions-user-${suffix}@example.test`
  const ADMIN_SUB = `questions-admin-${suffix}`
  const ADMIN_EMAIL = `questions-admin-${suffix}@example.test`

  let userToken: string
  let adminToken: string
  let restoreFetch: () => void
  let subject: Subject
  let question: Question
  let options: Option[]

  const updateBody = () => ({
    question: 'Updated question?',
    correct_option: 'A',
    options: options.map((option) => ({ id: option.id, name: option.name })),
  })

  group.setup(async () => {
    ZitadelAuthService.clearCachesForTests()
    const fixture = await createOidcFixture()
    restoreFetch = installFetchMock(fixture.jwk)
    userToken = await fixture.sign(userPayload(USER_SUB, USER_EMAIL))
    adminToken = await fixture.sign(adminPayload(ADMIN_SUB, ADMIN_EMAIL))

    subject = await Subject.create({
      name: `Questions Subject ${suffix}`,
      slug: `questions-subject-${suffix}`,
      year: 1,
    })
    const questionType = await QuestionType.create({ name: 'MC', subjectId: subject.id })
    question = await Question.create({
      question: 'Original question?',
      image: '',
      exam: '',
      correctOption: 'A',
      subjectId: subject.id,
      questionTypeId: questionType.id,
    })
    options = await Option.createMany([
      { name: 'Yes', order: 'A', questionId: question.id },
      { name: 'No', order: 'B', questionId: question.id },
    ])
  })

  group.teardown(async () => {
    restoreFetch()
    ZitadelAuthService.clearCachesForTests()
    await Option.query().where('questionId', question.id).delete()
    await Question.query().where('subjectId', subject.id).delete()
    await QuestionType.query().where('subjectId', subject.id).delete()
    await subject.delete()
  })

  test('questions created without a source default to REAL_EXAM', async ({ assert }) => {
    const row = await db.from('questions').where('id', question.id).first()
    assert.equal(row.source, 'REAL_EXAM')
  })

  test('GET /questions/:id exposes the source', async ({ client, assert }) => {
    const res = await client.get(`/questions/${question.id}`)
    res.assertStatus(200)
    assert.equal(res.body().source, 'REAL_EXAM')
  })

  test('PUT /questions/:id updates the source for admins', async ({ client, assert }) => {
    const res = await client
      .put(`/questions/${question.id}`)
      .header('Authorization', `Bearer ${adminToken}`)
      .json({ ...updateBody(), source: 'AI_GENERATED' })
    res.assertStatus(204)

    const show = await client.get(`/questions/${question.id}`)
    assert.equal(show.body().source, 'AI_GENERATED')
  })

  test('PUT /questions/:id without source keeps the stored value', async ({ client, assert }) => {
    await db.from('questions').where('id', question.id).update({ source: 'MANUAL' })

    const res = await client
      .put(`/questions/${question.id}`)
      .header('Authorization', `Bearer ${adminToken}`)
      .json(updateBody())
    res.assertStatus(204)

    const row = await db.from('questions').where('id', question.id).first()
    assert.equal(row.source, 'MANUAL')
  })

  test('PUT /questions/:id rejects a source outside the controlled set', async ({
    client,
    assert,
  }) => {
    await db.from('questions').where('id', question.id).update({ source: 'REAL_EXAM' })

    const res = await client
      .put(`/questions/${question.id}`)
      .header('Authorization', `Bearer ${adminToken}`)
      .json({ ...updateBody(), source: 'UNKNOWN' })
    res.assertStatus(422)

    const row = await db.from('questions').where('id', question.id).first()
    assert.equal(row.source, 'REAL_EXAM')
  })

  test('PUT /questions/:id rejects non-admins before touching the source', async ({
    client,
    assert,
  }) => {
    const res = await client
      .put(`/questions/${question.id}`)
      .header('Authorization', `Bearer ${userToken}`)
      .json({ ...updateBody(), source: 'MANUAL' })
    assert.include([401, 403], res.status())

    const row = await db.from('questions').where('id', question.id).first()
    assert.equal(row.source, 'REAL_EXAM')
  })

  test('PUT /questions/:id without a token is rejected and keeps the source', async ({
    client,
    assert,
  }) => {
    const res = await client
      .put(`/questions/${question.id}`)
      .json({ ...updateBody(), source: 'MANUAL' })
    res.assertStatus(401)

    const row = await db.from('questions').where('id', question.id).first()
    assert.equal(row.source, 'REAL_EXAM')
  })

  test('PUT /questions/:id does not store the source when an option id is foreign', async ({
    client,
    assert,
  }) => {
    const res = await client
      .put(`/questions/${question.id}`)
      .header('Authorization', `Bearer ${adminToken}`)
      .json({
        ...updateBody(),
        source: 'AI_GENERATED',
        options: [
          { id: options[0].id, name: 'Yes' },
          { id: 999999999, name: 'No' },
        ],
      })
    res.assertStatus(422)

    const row = await db.from('questions').where('id', question.id).first()
    assert.equal(row.source, 'REAL_EXAM')
  })

  test('PUT /questions/:id does not store the source when correct_option is invalid', async ({
    client,
    assert,
  }) => {
    const res = await client
      .put(`/questions/${question.id}`)
      .header('Authorization', `Bearer ${adminToken}`)
      .json({ ...updateBody(), correct_option: 'Z', source: 'AI_GENERATED' })
    res.assertStatus(422)

    const row = await db.from('questions').where('id', question.id).first()
    assert.equal(row.source, 'REAL_EXAM')
  })

  test('the database rejects values outside the controlled set', async ({ assert }) => {
    await assert.rejects(() =>
      db.from('questions').where('id', question.id).update({ source: 'UNKNOWN' })
    )
  })
})
