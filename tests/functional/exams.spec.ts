import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import ZitadelAuthService from '#services/auth/zitadel_auth_service'
import Subject from '#models/subject'
import QuestionType from '#models/question_type'
import Question from '#models/question'
import Option from '#models/option'
import Answer from '#models/answer'
import Score from '#models/score'
import User from '#models/user'
import ExamState from '#models/exam_state'
import {
  createOidcFixture,
  installFetchMock,
  userPayload,
  adminPayload,
} from '#tests/helpers/token_factory'

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
    await Option.query()
      .whereIn(
        'questionId',
        questions.map((q) => q.id)
      )
      .delete()
    await Question.query().where('subjectId', subject.id).delete()
    await QuestionType.query().where('subjectId', subject.id).delete()
    await subject.delete()
  })

  // --- Generation ---

  test('generate default exam returns questions array', async ({ client, assert }) => {
    const res = await client.get(`/exams/generate/${subject.id}`)
    res.assertStatus(200)
    assert.isArray(res.body())
    assert.lengthOf(res.body(), 10)
  })

  test('generate exam in mode requiring auth without token returns 401', async ({ client }) => {
    const res = await client.get(`/exams/generate/${subject.id}?mode=wrong`)
    res.assertStatus(401)
  })

  test('generate exam with valid token and auth-required mode is accepted', async ({
    client,
    assert,
  }) => {
    const res = await client
      .get(`/exams/generate/${subject.id}?mode=new`)
      .header('authorization', `Bearer ${userToken}`)
    // 200 with questions or 400 if not enough history — either means auth passed
    assert.oneOf(res.status(), [200, 400])
  })

  // --- Verification ---

  test('verify with missing body returns 422', async ({ client }) => {
    const res = await client.post('/exams/verify').json({})
    res.assertStatus(422)
  })

  test('verify with valid payload returns result', async ({ client, assert }) => {
    const res = await client.post('/exams/verify').json({
      subject_id: subject.id,
      mode: 'default',
      answers: questions.map((q) => ({ question_id: q.id, selected_option: 'A' })),
    })
    res.assertStatus(200)
    assert.equal(res.body().score, 100)
    assert.equal(res.body().wrong_answers, 0)
    assert.isTrue(res.body().passed)
  })

  test('verify with invalid subject returns 404', async ({ client }) => {
    const res = await client.post('/exams/verify').json({
      subject_id: 999999,
      answers: [{ question_id: 1 }],
    })
    res.assertStatus(404)
  })

  // --- History ---

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

  test('GET /admin/exams with admin token returns stats', async ({ client, assert }) => {
    const res = await client.get('/admin/exams').header('authorization', `Bearer ${adminToken}`)
    res.assertStatus(200)
    assert.isArray(res.body().exams_per_day)
  })
  async function mobileAttempt(client: any) {
    const id = randomUUID()
    const generated = await client
      .get(`/exams/generate/${subject.id}?attempt_id=${id}`)
      .header('authorization', `Bearer ${userToken}`)
    generated.assertStatus(200)
    const state = {
      version: 2,
      subjectId: subject.id,
      mode: 'default',
      questionIds: generated.body().map((item: any) => item.id),
      answers: [],
      time: 5,
      currentQuestionIndex: 0,
    }
    return {
      id,
      generated: generated.body(),
      state,
      verify: {
        subject_id: subject.id,
        mode: 'default',
        attempt_id: id,
        time: 5,
        answers: generated
          .body()
          .map((item: any) => ({ question_id: item.id, selected_option: 'A' })),
      },
    }
  }
  async function resetState() {
    const user = await User.findByOrFail('authSubject', USER_SUB)
    await ExamState.query().where('user_id', user.id).where('subject_id', subject.id).delete()
  }
  test('competing initial CAS saves allow exactly one winner', async ({ client, assert }) => {
    await resetState()
    const attempt = await mobileAttempt(client)
    const body = {
      subject_id: subject.id,
      mode: 'default',
      state: attempt.state,
      attempt_id: attempt.id,
      expected_revision: 0,
      restart_completed: true,
    }
    const replies = await Promise.all([
      client.post('/exams/state').header('authorization', `Bearer ${userToken}`).json(body),
      client.post('/exams/state').header('authorization', `Bearer ${userToken}`).json(body),
    ])
    assert.deepEqual(replies.map((item) => item.status()).sort(), [200, 409])
    const saved = replies.find((item) => item.status() === 200)!.body()
    const stale = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({ ...body, expected_revision: saved.revision + 1, expected_state_id: saved.id })
    stale.assertStatus(409)
    const removed = await client
      .delete(
        `/exams/state?subject_id=${subject.id}&mode=default&expected_revision=${saved.revision + 1}&expected_state_id=${saved.id}`
      )
      .header('authorization', `Bearer ${userToken}`)
    removed.assertStatus(409)
  })
  test('completed cloud row accepts a new attempt without deleting a newer draft', async ({
    client,
  }) => {
    await resetState()
    const first = await mobileAttempt(client)
    const save = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({
        subject_id: subject.id,
        mode: 'default',
        state: first.state,
        attempt_id: first.id,
        expected_revision: 0,
        restart_completed: true,
      })
    save.assertStatus(200)
    const done = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(first.verify)
    done.assertStatus(200)
    const second = await mobileAttempt(client)
    const restart = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({
        subject_id: subject.id,
        mode: 'default',
        state: second.state,
        attempt_id: second.id,
        expected_revision: 0,
        restart_completed: true,
      })
    restart.assertStatus(200)
    const replay = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(first.verify)
    replay.assertStatus(200)
    const pending = await client
      .get(`/exams/state?subject_id=${subject.id}&mode=default`)
      .header('authorization', `Bearer ${userToken}`)
    pending.assertStatus(200)
    pending.assertBodyContains({ attempt_id: second.id })
    const nextResult = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(second.verify)
    nextResult.assertStatus(200)
    if (nextResult.body().id === done.body().id)
      throw new Error('Distinct attempts were deduplicated')
  })
  test('concurrent verification replays the same result and applies grading once', async ({
    client,
    assert,
  }) => {
    const attempt = await mobileAttempt(client)
    const user = await User.findByOrFail('authSubject', USER_SUB)
    const previousScore = await Score.query()
      .where('user_id', user.id)
      .where('subject_id', subject.id)
      .first()
    const scoreBefore = previousScore?.score ?? 0
    const before = await Answer.query()
      .where('user_id', user.id)
      .where('subject_id', subject.id)
      .count('* as total')
      .first()
    const results = await Promise.all([
      client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json(attempt.verify),
      client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json(attempt.verify),
    ])
    results.forEach((item) => item.assertStatus(200))
    assert.deepEqual(results[0].body(), results[1].body())
    const after = await Answer.query()
      .where('user_id', user.id)
      .where('subject_id', subject.id)
      .count('* as total')
      .first()
    assert.equal(Number(after!.$extras.total), Number(before!.$extras.total) + 1)
    const scoreAfter = await Score.query()
      .where('user_id', user.id)
      .where('subject_id', subject.id)
      .firstOrFail()
    assert.equal(scoreAfter.score, scoreBefore + 100)
    const changed = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json({
        ...attempt.verify,
        answers: attempt.verify.answers.map((item: any) => ({ ...item, selected_option: 'B' })),
      })
    changed.assertStatus(409)
  })
  test('immutable recovery and grading survive question text and answer edits', async ({
    client,
    assert,
  }) => {
    const attempt = await mobileAttempt(client)
    const changed = questions[0]
    const original = changed.question
    await changed.merge({ question: 'Edited later', correctOption: 'B' }).save()
    try {
      const recovered = await client
        .get(`/exams/attempts/${attempt.id}`)
        .header('authorization', `Bearer ${userToken}`)
      recovered.assertStatus(200)
      assert.deepEqual(recovered.body().questions, attempt.generated)
      assert.isUndefined(recovered.body().questions[0].correctOption)
      const graded = await client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json(attempt.verify)
      graded.assertStatus(200)
      assert.equal(graded.body().score, 100)
      const result = await client
        .get(`/exams/attempts/${attempt.id}`)
        .header('authorization', `Bearer ${userToken}`)
      assert.deepEqual(result.body().result, graded.body())
      const detail = await client
        .get(`/exams/${graded.body().id}`)
        .header('authorization', `Bearer ${userToken}`)
      detail.assertStatus(200)
      assert.equal(
        detail.body().questions.find((item: any) => item.question.id === changed.id).question
          .question,
        original
      )
    } finally {
      await changed.merge({ question: original, correctOption: 'A' }).save()
    }
  })
  test('another identity cannot recover or submit the owned attempt', async ({ client }) => {
    const attempt = await mobileAttempt(client)
    const anonymous = await client.get(`/exams/attempts/${attempt.id}`)
    anonymous.assertStatus(404)
    const other = await client
      .get(`/exams/attempts/${attempt.id}`)
      .header('authorization', `Bearer ${adminToken}`)
    other.assertStatus(404)
    const submit = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${adminToken}`)
      .json(attempt.verify)
    submit.assertStatus(409)
  })
})
