import { test } from '@japa/runner'
import limiter from '@adonisjs/limiter/services/main'
import { createHash, randomUUID } from 'node:crypto'
import ZitadelAuthService from '#services/auth/zitadel_auth_service'
import Subject from '#models/subject'
import QuestionType from '#models/question_type'
import Question from '#models/question'
import Option from '#models/option'
import Answer from '#models/answer'
import Score from '#models/score'
import User from '#models/user'
import ExamState from '#models/exam_state'
import ExamAttempt from '#models/exam_attempt'
import db from '@adonisjs/lucid/services/db'
import ExamGenerationService from '#services/exams/exam_generation_service'
import {
  createOidcFixture,
  installFetchMock,
  userPayload,
  adminPayload,
} from '#tests/helpers/token_factory'

test.group('Exams', (group) => {
  group.each.setup(() => limiter.clear(['memory']))
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
    anonymous.assertStatus(401)
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
  test('attempt persistence requires auth while legacy anonymous exams remain supported', async ({
    client,
  }) => {
    const id = randomUUID()
    const generated = await client.get(`/exams/generate/${subject.id}?attempt_id=${id}`)
    generated.assertStatus(401)
    const verified = await client.post('/exams/verify').json({
      subject_id: subject.id,
      attempt_id: id,
      answers: questions.map((q) => ({ question_id: q.id, selected_option: 'A' })),
    })
    verified.assertStatus(401)
  })

  test('duplicate and concurrent generation return clean conflicts without replacing snapshots', async ({
    client,
    assert,
  }) => {
    const attempt = await mobileAttempt(client)
    const duplicate = await client
      .get(`/exams/generate/${subject.id}?attempt_id=${attempt.id}`)
      .header('authorization', `Bearer ${userToken}`)
    duplicate.assertStatus(409)
    assert.equal(duplicate.body().message, 'Attempt ID already exists; recover it or use a new ID')
    const recovered = await client
      .get(`/exams/attempts/${attempt.id}`)
      .header('authorization', `Bearer ${userToken}`)
    assert.deepEqual(recovered.body().questions, attempt.generated)
    const id = randomUUID()
    const concurrent = await Promise.all(
      [0, 1].map(() =>
        client
          .get(`/exams/generate/${subject.id}?attempt_id=${id}`)
          .header('authorization', `Bearer ${userToken}`)
      )
    )
    assert.sameMembers(
      concurrent.map((res) => res.status()),
      [200, 409]
    )
  })

  test('UUID v7 can generate, recover and replay grading with changed retry time', async ({
    client,
    assert,
  }) => {
    const id = randomUUID().replace(/-4/, '-7')
    const generated = await client
      .get(`/exams/generate/${subject.id}?attempt_id=${id}`)
      .header('authorization', `Bearer ${userToken}`)
    generated.assertStatus(200)
    const recovered = await client
      .get(`/exams/attempts/${id}`)
      .header('authorization', `Bearer ${userToken}`)
    recovered.assertStatus(200)
    assert.deepEqual(recovered.body().questions, generated.body())
    const body = {
      subject_id: subject.id,
      attempt_id: id,
      time: 5,
      answers: generated.body().map((q: any) => ({ question_id: q.id, selected_option: 'A' })),
    }
    const first = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(body)
    first.assertStatus(200)
    const retry = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json({ ...body, time: 20 })
    retry.assertStatus(200)
    assert.deepEqual(retry.body(), first.body())
    const stored = await Answer.findOrFail(first.body().id)
    assert.equal(stored.time, 5)
    const changedConfig = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json({ ...body, n_of_questions: 10 })
    changedConfig.assertStatus(200)
    assert.deepEqual(changedConfig.body(), first.body())
  })

  test('deleted snapshot option returns clean 409 and rolls back grading', async ({
    client,
    assert,
  }) => {
    const attempt = await mobileAttempt(client)
    const option = await Option.query()
      .where('questionId', questions[0].id)
      .where('order', 'A')
      .firstOrFail()
    const attrs = {
      id: option.id,
      name: option.name,
      order: option.order,
      questionId: option.questionId,
    }
    await option.delete()
    try {
      const res = await client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json(attempt.verify)
      res.assertStatus(409)
      assert.equal(res.body().message, 'Attempt question or option no longer available')
      const recovered = await client
        .get(`/exams/attempts/${attempt.id}`)
        .header('authorization', `Bearer ${userToken}`)
      assert.isNull(recovered.body().result)
      const stored = await ExamAttempt.findByOrFail('id', attempt.id)
      assert.isUndefined(stored.snapshot.grading)
    } finally {
      await Option.create(attrs)
    }
  })

  test('state deletion validates revision and row ID with the same numeric rules as saves', async ({
    client,
  }) => {
    for (const query of [
      'expected_revision=-1',
      'expected_revision=1.5',
      'expected_revision=oops',
      'expected_revision=1&expected_state_id=0',
    ]) {
      const res = await client
        .delete(`/exams/state?subject_id=${subject.id}&mode=default&${query}`)
        .header('authorization', `Bearer ${userToken}`)
      res.assertStatus(422)
    }
  })
  test('attempt recovery is exam-throttled', async ({ client }) => {
    for (let i = 0; i < 20; i++) {
      const res = await client
        .get(`/exams/attempts/${randomUUID()}`)
        .header('authorization', `Bearer ${userToken}`)
      res.assertStatus(404)
    }
    const blocked = await client
      .get(`/exams/attempts/${randomUUID()}`)
      .header('authorization', `Bearer ${userToken}`)
    blocked.assertStatus(429)
  })
  for (const removed of ['option', 'question'] as const) {
    test(`completed review retains questions and selections after canonical ${removed} deletion`, async ({
      client,
      assert,
    }) => {
      const attempt = await mobileAttempt(client)
      const answers = attempt.verify.answers
        .map((item: any, index: number) => ({
          question_id: item.question_id,
          ...(index === 1 ? {} : { selected_option: index === 2 ? 'B' : 'A' }),
        }))
        .reverse()
      const body = { ...attempt.verify, answers }
      const graded = await client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json(body)
      graded.assertStatus(200)
      const before = await client
        .get(`/exams/${graded.body().id}`)
        .header('authorization', `Bearer ${userToken}`)
      before.assertStatus(200)
      const snapshot = await ExamAttempt.findByOrFail('id', attempt.id)
      const first = snapshot.snapshot.questions[0]
      const questionRow = await db.from('questions').where('id', first.id).firstOrFail()
      const optionRows = await db.from('options').where('question_id', first.id)
      const selected = first.options.find((option) => option.order === 'A')!
      if (removed === 'option') await Option.query().where('id', selected.id).delete()
      else await Question.query().where('id', first.id).delete()
      try {
        const after = await client
          .get(`/exams/${graded.body().id}`)
          .header('authorization', `Bearer ${userToken}`)
        after.assertStatus(200)
        assert.lengthOf(after.body().questions, 10)
        assert.deepEqual(after.body(), before.body())
        assert.deepEqual(
          after.body().questions.map((item: any) => item.question.id),
          attempt.generated.map((item: any) => item.id)
        )
        const review = after.body().questions.find((item: any) => item.question.id === first.id)
        assert.equal(review.selected_option_id, selected.id)
        assert.isFalse(review.is_wrong)
        const unanswered = after.body().questions[1]
        assert.isNull(unanswered.selected_option_id)
        assert.isTrue(unanswered.is_wrong)
        assert.isTrue(after.body().questions[2].is_wrong)
        const retry = await client
          .post('/exams/verify')
          .header('authorization', `Bearer ${userToken}`)
          .json(body)
        retry.assertStatus(200)
        assert.deepEqual(retry.body(), graded.body())
        const recovered = await client
          .get(`/exams/attempts/${attempt.id}`)
          .header('authorization', `Bearer ${userToken}`)
        recovered.assertStatus(200)
        assert.deepEqual(recovered.body().questions, attempt.generated)
        assert.isUndefined(recovered.body().grading)
        const adminReview = await client
          .get(`/exams/${graded.body().id}`)
          .header('authorization', `Bearer ${adminToken}`)
        adminReview.assertStatus(200)
        assert.deepEqual(adminReview.body(), before.body())
      } finally {
        if (removed === 'question') await db.table('questions').insert(questionRow)
        await db
          .table('options')
          .insert(
            removed === 'option'
              ? optionRows.filter((option) => option.id === selected.id)
              : optionRows
          )
      }
    })
  }
  test('completed snapshots without grading retain the existing review contract', async ({
    client,
    assert,
  }) => {
    const attempt = await mobileAttempt(client)
    const graded = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(attempt.verify)
    graded.assertStatus(200)
    const before = await client
      .get(`/exams/${graded.body().id}`)
      .header('authorization', `Bearer ${userToken}`)
    before.assertStatus(200)
    const stored = await ExamAttempt.findByOrFail('id', attempt.id)
    delete stored.snapshot.grading
    await stored.merge({ snapshot: { ...stored.snapshot } }).save()
    const after = await client
      .get(`/exams/${graded.body().id}`)
      .header('authorization', `Bearer ${userToken}`)
    after.assertStatus(200)
    assert.deepEqual(after.body(), before.body())
  })
  test('non-custom verification accepts its resolved count even when generation omitted it', async ({
    client,
    assert,
  }) => {
    const attempt = await mobileAttempt(client)
    const graded = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json({ ...attempt.verify, n_of_questions: 10 })
    graded.assertStatus(200)
    const retry = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(attempt.verify)
    retry.assertStatus(200)
    assert.deepEqual(retry.body(), graded.body())
  })

  test('different owners can reuse UUIDs without sharing recovery, grading or state', async ({
    client,
    assert,
  }) => {
    await resetState()
    const first = await mobileAttempt(client)
    const second = await client
      .get(`/exams/generate/${subject.id}?attempt_id=${first.id}`)
      .header('authorization', `Bearer ${adminToken}`)
    second.assertStatus(200)
    const other = await client
      .get(`/exams/attempts/${first.id}`)
      .header('authorization', `Bearer ${adminToken}`)
    other.assertStatus(200)
    assert.deepEqual(other.body().questions, second.body())
    const saved = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({
        subject_id: subject.id,
        mode: 'default',
        state: first.state,
        attempt_id: first.id,
      })
    saved.assertStatus(200)
    const results = await Promise.all([
      client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json(first.verify),
      client
        .post('/exams/verify')
        .header('authorization', `Bearer ${adminToken}`)
        .json({
          ...first.verify,
          answers: second.body().map((q: any) => ({ question_id: q.id, selected_option: 'B' })),
        }),
    ])
    results.forEach((r) => r.assertStatus(200))
    assert.notEqual(results[0].body().id, results[1].body().id)
    assert.equal(results[0].body().score, 100)
    assert.equal(results[1].body().score, 0)
    for (const [index, token] of [userToken, adminToken].entries()) {
      const recovered = await client
        .get(`/exams/attempts/${first.id}`)
        .header('authorization', `Bearer ${token}`)
      assert.deepEqual(recovered.body().result, results[index].body())
    }
    const owner = await User.findByOrFail('authSubject', USER_SUB)
    const attempts = await ExamAttempt.query().where('id', first.id)
    assert.lengthOf(attempts, 2)
    const wrongOwnerId = await User.create({
      authSubject: randomUUID(),
      email: `${randomUUID()}@test.example`,
      name: 'Other',
    })
    try {
      await assert.rejects(
        () =>
          db.table('exam_states').insert({
            user_id: wrongOwnerId.id,
            subject_id: subject.id,
            mode: 'default',
            attempt_id: first.id,
            state: {},
          }),
        /foreign key/
      )
      await assert.rejects(
        () =>
          db.table('exam_attempts').insert({
            id: randomUUID(),
            user_id: null,
            subject_id: subject.id,
            mode: 'default',
            snapshot: '{}',
            created_at: new Date(),
            updated_at: new Date(),
          }),
        /not-null/
      )
    } finally {
      await wrongOwnerId.delete()
    }
    const completedState = await ExamState.query()
      .where('user_id', owner.id)
      .where('subject_id', subject.id)
      .firstOrFail()
    assert.isTrue(completedState.isCompleted)
  })

  test('incomplete-attempt cap is atomic, per owner, and completion frees a slot', async ({
    client,
    assert,
  }) => {
    const user = await User.findByOrFail('authSubject', USER_SUB)
    const original = await ExamAttempt.query().where('user_id', user.id).whereNull('result')
    // Remove only this test group's unfinished fixtures to make the cap boundary deterministic.
    await ExamState.query().where('user_id', user.id).delete()
    await ExamAttempt.query()
      .whereIn(
        'id',
        original.map((a) => a.id)
      )
      .where('user_id', user.id)
      .delete()
    const first = await mobileAttempt(client)
    const source = await ExamAttempt.query()
      .where('user_id', user.id)
      .where('id', first.id)
      .firstOrFail()
    await db.table('exam_attempts').insert(
      Array.from({ length: 18 }, () => ({
        id: randomUUID(),
        user_id: user.id,
        subject_id: subject.id,
        mode: 'default',
        snapshot: JSON.stringify(source.snapshot),
        created_at: new Date(),
        updated_at: new Date(),
      }))
    )
    const responses = await Promise.all(
      [0, 1].map(() =>
        client
          .get(`/exams/generate/${subject.id}?attempt_id=${randomUUID()}`)
          .header('authorization', `Bearer ${userToken}`)
      )
    )
    assert.sameMembers(
      responses.map((r) => r.status()),
      [200, 409]
    )
    const full = await client
      .get(`/exams/generate/${subject.id}?attempt_id=${randomUUID()}`)
      .header('authorization', `Bearer ${userToken}`)
    full.assertStatus(409)
    assert.equal(
      full.body().message,
      'Too many unfinished attempts; complete an existing attempt before generating another'
    )
    const anotherOwner = await client
      .get(`/exams/generate/${subject.id}?attempt_id=${randomUUID()}`)
      .header('authorization', `Bearer ${adminToken}`)
    anotherOwner.assertStatus(200)
    const graded = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(first.verify)
    graded.assertStatus(200)
    const released = await client
      .get(`/exams/generate/${subject.id}?attempt_id=${randomUUID()}`)
      .header('authorization', `Bearer ${userToken}`)
    released.assertStatus(200)
    const count = await ExamAttempt.query()
      .where('user_id', user.id)
      .whereNull('result')
      .count('* as total')
      .firstOrFail()
    assert.equal(Number(count.$extras.total), 20)
  })

  test('legacy verification never completes an attempt-bound draft, but does complete legacy state', async ({
    client,
    assert,
  }) => {
    await resetState()
    const user = await User.findByOrFail('authSubject', USER_SUB)
    await ExamAttempt.query().where('user_id', user.id).whereNull('result').delete()
    const attempt = await mobileAttempt(client)
    const state = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({
        subject_id: subject.id,
        mode: 'default',
        state: attempt.state,
        attempt_id: attempt.id,
      })
    state.assertStatus(200)
    const { attempt_id: attemptId, ...legacy } = attempt.verify
    const completed = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(legacy)
    completed.assertStatus(200)
    const recorded = await ExamAttempt.query()
      .where('user_id', user.id)
      .where('id', attemptId)
      .firstOrFail()
    assert.isNull(recorded.result)
    const current = await client
      .get(`/exams/state?subject_id=${subject.id}&mode=default`)
      .header('authorization', `Bearer ${userToken}`)
    current.assertStatus(200)
    assert.equal(current.body().attempt_id, attempt.id)
    assert.isUndefined(current.body().state.isCompleted)
    await resetState()
    const legacyState = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({ subject_id: subject.id, mode: 'default', state: attempt.state })
    legacyState.assertStatus(200)
    const verified = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(legacy)
    verified.assertStatus(200)
    const after = await client
      .get(`/exams/state?subject_id=${subject.id}&mode=default`)
      .header('authorization', `Bearer ${userToken}`)
    assert.isNull(after.body().state)
  })

  test('generation rejects a serialized option absent from the canonical question', async ({
    assert,
  }) => {
    const service = new ExamGenerationService()
    const user = await User.findByOrFail('authSubject', USER_SUB)
    ;(service as any).serializeQuestions = () => [
      {
        id: questions[0].id,
        question: 'Broken',
        exam: '',
        image: '',
        question_type: 'MC',
        options: [{ name: 'Unknown', order: 'Z' }],
      },
    ]
    await assert.rejects(
      () =>
        service.generate({
          subject,
          mode: 'default',
          userId: user.id,
          nOfQuestions: null,
          filter: null,
          attemptId: randomUUID(),
        }),
      /Snapshot option Z is unavailable/
    )
  })
  test('pre-normalization completed hashes still replay with omitted or resolved counts', async ({
    client,
    assert,
  }) => {
    const attempt = await mobileAttempt(client)
    const completed = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(attempt.verify)
    completed.assertStatus(200)
    const stored = await ExamAttempt.findByOrFail('id', attempt.id)
    stored.requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          subject: subject.id,
          mode: 'default',
          count: null,
          penalty: null,
          answers: attempt.verify.answers
            .map((item: any) => ({ id: item.question_id, order: 'A' }))
            .sort((a: any, b: any) => a.id - b.id),
        })
      )
      .digest('hex')
    await stored.save()
    const retry = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json({ ...attempt.verify, n_of_questions: 10 })
    retry.assertStatus(200)
    assert.deepEqual(retry.body(), completed.body())
  })

  test('custom count and penalty remain immutable', async ({ client, assert }) => {
    const id = randomUUID()
    const generated = await client
      .get(
        `/exams/generate/${subject.id}?mode=custom&n_of_questions=5&penalizing_factor=0.5&attempt_id=${id}`
      )
      .header('authorization', `Bearer ${userToken}`)
    generated.assertStatus(200)
    const body = {
      subject_id: subject.id,
      attempt_id: id,
      mode: 'custom',
      n_of_questions: 5,
      penalizing_factor: 0.5,
      answers: generated.body().map((q: any) => ({ question_id: q.id, selected_option: 'A' })),
    }
    const changed = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json({ ...body, penalizing_factor: 0 })
    changed.assertStatus(409)
    const missingCount = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json({ ...body, n_of_questions: undefined })
    missingCount.assertStatus(400)
    const valid = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(body)
    valid.assertStatus(200)
    assert.equal(valid.body().score, 100)
  })

  test('review fails cleanly for an incomplete grading snapshot', async ({ client }) => {
    const attempt = await mobileAttempt(client)
    const graded = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(attempt.verify)
    graded.assertStatus(200)
    const stored = await ExamAttempt.findByOrFail('id', attempt.id)
    await stored.merge({ snapshot: { ...stored.snapshot, grading: [] } }).save()
    const review = await client
      .get(`/exams/${graded.body().id}`)
      .header('authorization', `Bearer ${userToken}`)
    review.assertStatus(409)
    review.assertBodyContains({ message: 'Exam review details are unavailable' })
  })

  test('legacy review after canonical question deletion follows cascade instead of returning 500', async ({
    client,
    assert,
  }) => {
    const body = {
      subject_id: subject.id,
      mode: 'default',
      answers: questions.map((q) => ({ question_id: q.id, selected_option: 'A' })),
    }
    const graded = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(body)
    graded.assertStatus(200)
    const questionRow = await db.from('questions').where('id', questions[0].id).firstOrFail()
    const optionRows = await db.from('options').where('question_id', questions[0].id)
    await Question.query().where('id', questions[0].id).delete()
    try {
      const review = await client
        .get(`/exams/${graded.body().id}`)
        .header('authorization', `Bearer ${userToken}`)
      review.assertStatus(200)
      assert.lengthOf(review.body().questions, 9)
    } finally {
      await db.table('questions').insert(questionRow)
      await db.table('options').insert(optionRows)
    }
  })
})
