import { test } from '@japa/runner'
import limiter from '@adonisjs/limiter/services/main'
import { createHash, randomUUID } from 'node:crypto'
import { DateTime, Settings } from 'luxon'
import { lockExamOwner, pruneUnfinishedAttempts } from '#services/exams/exam_attempt_lifecycle'
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
import ace from '@adonisjs/core/services/ace'
import PruneExamAttempts from '../../commands/prune_exam_attempts.js'
import { importReviewedQuestions } from '#services/questions/reviewed_import'
import ExamGenerationService from '#services/exams/exam_generation_service'
import ExamVerificationService from '#services/exams/exam_verification_service'
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
    await resetState()
    const attempt = await mobileAttempt(client)
    const user = await User.findByOrFail('authSubject', USER_SUB)
    const previousScore = await Score.query()
      .where('user_id', user.id)
      .where('subject_id', subject.id)
      .first()
    const scoreBefore = previousScore?.score ?? 0
    const changed = questions[0]
    const original = changed.question
    const options = await Option.query().where('question_id', changed.id)
    const imported = await importReviewedQuestions(
      {
        batch_id: randomUUID(),
        questions: [
          {
            import_key: `exam-correction:${randomUUID()}`,
            question_id: changed.id,
            subject_id: subject.id,
            question_type_id: changed.questionTypeId,
            exam: 'synthetic-correction',
            source: 'REAL_EXAM',
            question: 'Edited later',
            correct_option: 'B',
            options: options.map(({ order, name }) => ({ order, name })),
            review: {
              status: 'approved',
              reviewer: 'Synthetic test reviewer',
              reviewed_at: new Date(Date.now() - 1000).toISOString(),
              reference: 'Synthetic correction fixture',
              duplicates_checked: true,
            },
          },
        ],
      },
      true
    )
    assert.equal(imported.status, 'applied')
    await changed.refresh()
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
      assert.equal(
        detail.body().questions.find((item: any) => item.question.id === changed.id).correct_option,
        'A'
      )
      const next = await mobileAttempt(client)
      const nextResult = await client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json(next.verify)
      nextResult.assertStatus(200)
      assert.equal(nextResult.body().score, 90)
      await changed.merge({ question: 'Corrected again', correctOption: 'A' }).save()
      const replay = await client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json(next.verify)
      assert.deepEqual(replay.body(), nextResult.body())
      const nextReview = await client
        .get(`/exams/${nextResult.body().id}`)
        .header('authorization', `Bearer ${userToken}`)
      nextReview.assertStatus(200)
      assert.equal(
        nextReview.body().questions.find((item: any) => item.question.id === changed.id)
          .correct_option,
        'B'
      )
      const scoreAfter = await Score.query()
        .where('user_id', user.id)
        .where('subject_id', subject.id)
        .firstOrFail()
      assert.equal(scoreAfter.score, scoreBefore + 190)
    } finally {
      await changed.merge({ question: original, correctOption: 'A', exam: '' }).save()
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

  test('generation atomically evicts least-active unfinished attempts without locking out owners', async ({
    client,
    assert,
  }) => {
    await resetState()
    const user = await User.findByOrFail('authSubject', USER_SUB)
    await ExamAttempt.query().where('user_id', user.id).whereNull('result').delete()
    const completed = await mobileAttempt(client)
    const graded = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(completed.verify)
    graded.assertStatus(200)
    const first = await mobileAttempt(client)
    const saved = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({ subject_id: subject.id, mode: 'default', attempt_id: first.id, state: first.state })
    saved.assertStatus(200)
    const source = await ExamAttempt.query()
      .where('user_id', user.id)
      .where('id', first.id)
      .firstOrFail()
    const old = DateTime.local().minus({ days: 1 })
    await source.merge({ updatedAt: old }).save()
    const fixtures = Array.from({ length: 19 }, () => randomUUID())
    await db.table('exam_attempts').insert(
      fixtures.map((id) => ({
        id,
        user_id: user.id,
        subject_id: subject.id,
        mode: 'default',
        snapshot: JSON.stringify(source.snapshot),
        created_at: new Date(),
        updated_at: new Date(),
      }))
    )
    const other = await client
      .get(`/exams/generate/${subject.id}?attempt_id=${first.id}`)
      .header('authorization', `Bearer ${adminToken}`)
    other.assertStatus(200)
    // A duplicate must never evict its own stored identity or any other draft.
    const duplicate = await client
      .get(`/exams/generate/${subject.id}?attempt_id=${first.id}`)
      .header('authorization', `Bearer ${userToken}`)
    duplicate.assertStatus(409)
    assert.exists(await ExamAttempt.find(source.rowId))
    assert.exists(await ExamState.find(saved.body().id))
    const broken = new ExamGenerationService()
    ;(broken as any).serializeQuestions = () => [
      {
        id: questions[0].id,
        options: [{ name: 'Unavailable', order: 'Z' }],
      },
    ]
    await assert.rejects(
      () =>
        broken.generate({
          subject,
          mode: 'default',
          userId: user.id,
          nOfQuestions: null,
          filter: null,
          attemptId: randomUUID(),
        }),
      /Snapshot option Z is unavailable/
    )
    // Snapshot failure happens after eviction; the transaction must restore the attempt and draft.
    assert.exists(await ExamAttempt.find(source.rowId))
    assert.exists(await ExamState.find(saved.body().id))
    assert.lengthOf(await ExamAttempt.query().where('user_id', user.id).whereNull('result'), 20)
    const ids = [randomUUID(), randomUUID()]
    const responses = await Promise.all(
      ids.map((id) =>
        client
          .get(`/exams/generate/${subject.id}?attempt_id=${id}`)
          .header('authorization', `Bearer ${userToken}`)
      )
    )
    responses.forEach((response) => response.assertStatus(200))
    const pending = await ExamAttempt.query().where('user_id', user.id).whereNull('result')
    assert.lengthOf(pending, 20)
    ids.forEach((id) =>
      assert.include(
        pending.map((attempt) => attempt.id),
        id
      )
    )
    assert.isNull(await ExamAttempt.find(source.rowId))
    assert.isNull(await ExamState.find(saved.body().id))
    const evicted = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(first.verify)
    evicted.assertStatus(409)
    const otherRetained = await client
      .get(`/exams/attempts/${first.id}`)
      .header('authorization', `Bearer ${adminToken}`)
    otherRetained.assertStatus(200)
    const replay = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(completed.verify)
    replay.assertStatus(200)
    assert.deepEqual(replay.body(), graded.body())
  })

  test('unfinished cleanup preserves the cutoff instant across timezone offsets', async ({
    assert,
  }) => {
    const previousZone = Settings.defaultZone
    try {
      // Both positive and negative offsets must preserve the 30-day instant.
      for (const zone of ['Asia/Kolkata', 'America/New_York']) {
        Settings.defaultZone = zone
        const user = await User.findByOrFail('authSubject', USER_SUB)
        const common = {
          userId: user.id,
          subjectId: subject.id,
          mode: 'default',
          snapshot: { questions: [], nOfQuestions: null, penalizingFactor: null },
        }
        const stale = await ExamAttempt.create({
          ...common,
          id: randomUUID(),
          updatedAt: DateTime.local().minus({ days: 30, minutes: 1 }),
        })
        const recent = await ExamAttempt.create({
          ...common,
          id: randomUUID(),
          updatedAt: DateTime.local().minus({ days: 30 }).plus({ minutes: 1 }),
        })
        await db.transaction(async (trx) => {
          await lockExamOwner(trx, user.id)
          await pruneUnfinishedAttempts(trx, user.id)
        })
        assert.isNull(await ExamAttempt.find(stale.rowId))
        assert.exists(await ExamAttempt.find(recent.rowId))
        await recent.delete()
      }
    } finally {
      Settings.defaultZone = previousZone
    }
  })

  test('generation prunes stale unfinished attempts before enforcing the cap', async ({
    client,
    assert,
  }) => {
    await resetState()
    const user = await User.findByOrFail('authSubject', USER_SUB)
    await ExamAttempt.query().where('user_id', user.id).whereNull('result').delete()
    const stale = await mobileAttempt(client)
    const saved = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({
        subject_id: subject.id,
        mode: 'default',
        attempt_id: stale.id,
        state: stale.state,
      })
    saved.assertStatus(200)
    const source = await ExamAttempt.findByOrFail('id', stale.id)
    const old = DateTime.utc().minus({ days: 31 }).toSQL()!
    await ExamAttempt.query().where('row_id', source.rowId).update({ updatedAt: old })
    const otherOwner = await User.findByOrFail('authSubject', ADMIN_SUB)
    const otherId = randomUUID()
    await db.table('exam_attempts').insert(
      [
        ...Array.from({ length: 19 }, () => ({ user_id: user.id, updated_at: new Date() })),
        { user_id: otherOwner.id, updated_at: old },
      ].map((row) => ({
        ...row,
        id: row.user_id === otherOwner.id ? otherId : randomUUID(),
        subject_id: subject.id,
        mode: 'default',
        snapshot: JSON.stringify(source.snapshot),
        created_at: old,
      }))
    )
    const fresh = await mobileAttempt(client)
    assert.isNull(await ExamAttempt.find(source.rowId))
    assert.isNull(await ExamState.find(saved.body().id))
    assert.exists(await ExamAttempt.findBy('id', otherId))
    assert.exists(await ExamAttempt.findBy('id', fresh.id))
    const full = await client
      .get(`/exams/generate/${subject.id}?attempt_id=${randomUUID()}`)
      .header('authorization', `Bearer ${userToken}`)
    full.assertStatus(200)
    await ExamAttempt.query().where('user_id', user.id).whereNull('result').delete()
  })

  test('prune command retains completed and recently saved attempts, removing stale bound drafts', async ({
    client,
    assert,
  }) => {
    await resetState()
    const stale = await mobileAttempt(client)
    const saved = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({
        subject_id: subject.id,
        mode: 'default',
        attempt_id: stale.id,
        state: stale.state,
      })
    saved.assertStatus(200)
    const old = DateTime.utc().minus({ days: 31 }).toSQL()!
    const active = await mobileAttempt(client)
    await ExamAttempt.query().where('id', active.id).update({ updatedAt: old })
    const resaved = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({
        subject_id: subject.id,
        mode: 'default',
        attempt_id: active.id,
        state: active.state,
      })
    resaved.assertStatus(200)
    const completed = await mobileAttempt(client)
    const result = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(completed.verify)
    result.assertStatus(200)
    await ExamAttempt.query().where('id', completed.id).update({ updatedAt: old })
    const otherOwner = await User.findByOrFail('authSubject', ADMIN_SUB)
    await ExamAttempt.query().where('id', stale.id).update({ updatedAt: old })
    const source = await ExamAttempt.findByOrFail('id', stale.id)
    const otherId = randomUUID()
    await db.table('exam_attempts').insert({
      id: otherId,
      user_id: otherOwner.id,
      subject_id: subject.id,
      mode: 'default',
      snapshot: JSON.stringify(source.snapshot),
      created_at: old,
      updated_at: old,
    })
    await ExamState.query().where('user_id', otherOwner.id).where('subject_id', subject.id).delete()
    const otherState = await ExamState.create({
      userId: otherOwner.id,
      subjectId: subject.id,
      mode: 'default',
      attemptId: otherId,
      state: { ...stale.state, totalQuestions: 10, answered: 0 } as any,
    })
    const command = await ace.create(PruneExamAttempts, [])
    await command.exec()
    command.assertSucceeded()
    assert.isNull(await ExamAttempt.findBy('id', stale.id))
    assert.isNull(await ExamAttempt.findBy('id', otherId))
    assert.isNull(await ExamState.find(otherState.id))
    assert.exists(await ExamAttempt.findBy('id', active.id))
    assert.exists(await ExamState.find(resaved.body().id))
    assert.exists(await ExamAttempt.findBy('id', completed.id))
    const replay = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(completed.verify)
    assert.deepEqual(replay.body(), result.body())
  })

  test('pruning and grading serialize without deleting committed results', async ({
    client,
    assert,
  }) => {
    const attempt = await mobileAttempt(client)
    const user = await User.findByOrFail('authSubject', USER_SUB)
    const before = await Answer.query().where('user_id', user.id).count('* as total').firstOrFail()
    await ExamAttempt.query()
      .where('id', attempt.id)
      .update({ updatedAt: DateTime.utc().minus({ days: 31 }) })
    const command = await ace.create(PruneExamAttempts, [])
    const [, graded] = await Promise.all([
      command.exec(),
      client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json(attempt.verify),
    ])
    command.assertSucceeded()
    assert.oneOf(graded.status(), [200, 409])
    const stored = await ExamAttempt.query()
      .where('id', attempt.id)
      .where('user_id', user.id)
      .first()
    if (graded.status() === 200) assert.deepEqual(stored?.result, graded.body())
    else assert.isNull(stored)
    const after = await Answer.query().where('user_id', user.id).count('* as total').firstOrFail()
    assert.equal(
      Number(after.$extras.total),
      Number(before.$extras.total) + (graded.status() === 200 ? 1 : 0)
    )
  })

  test('deleted authenticated owners receive 401 without exam writes', async ({
    client,
    assert,
  }) => {
    const staleUser = await User.create({
      authSubject: randomUUID(),
      email: `${randomUUID()}@test.example`,
      name: 'Deleted',
    })
    await staleUser.delete()
    const original = ZitadelAuthService.prototype.authenticateAuthorizationHeader
    ZitadelAuthService.prototype.authenticateAuthorizationHeader = async () =>
      ({
        user: staleUser,
        claims: userPayload(USER_SUB, USER_EMAIL),
        accessToken: '',
      }) as any
    try {
      const generated = await client
        .get(`/exams/generate/${subject.id}?attempt_id=${randomUUID()}`)
        .header('authorization', 'Bearer stale')
      generated.assertStatus(401)
      const verified = await client
        .post('/exams/verify')
        .header('authorization', 'Bearer stale')
        .json({
          subject_id: subject.id,
          mode: 'default',
          answers: questions.map((q) => ({ question_id: q.id, selected_option: 'A' })),
        })
      verified.assertStatus(401)
      const state = {
        version: 2,
        subjectId: subject.id,
        mode: 'default',
        questionIds: questions.map((q) => q.id),
        answers: [],
        time: 0,
        currentQuestionIndex: 0,
      }
      const saved = await client
        .post('/exams/state')
        .header('authorization', 'Bearer stale')
        .json({ subject_id: subject.id, mode: 'default', state })
      saved.assertStatus(401)
      const cleared = await client
        .delete(`/exams/state?subject_id=${subject.id}&mode=default`)
        .header('authorization', 'Bearer stale')
      cleared.assertStatus(401)
      const discarded = await client
        .delete(`/exams/attempts/${randomUUID()}`)
        .header('authorization', 'Bearer stale')
      discarded.assertStatus(401)
      const attempts = await ExamAttempt.query().where('user_id', staleUser.id)
      const answers = await Answer.query().where('user_id', staleUser.id)
      assert.lengthOf(attempts, 0)
      assert.lengthOf(answers, 0)
    } finally {
      ZitadelAuthService.prototype.authenticateAuthorizationHeader = original
    }
  })

  test('legacy verify blocks unfinished stored state but permits a new exam after UUID grading', async ({
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
    const scoreBefore = await Score.query()
      .where('user_id', user.id)
      .where('subject_id', subject.id)
      .first()
    const answersBefore = await Answer.query()
      .where('user_id', user.id)
      .count('* as total')
      .firstOrFail()
    const blocked = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(legacy)
    blocked.assertStatus(409)
    assert.include(blocked.body().message, `GET /exams/attempts/${attempt.id}`)
    assert.include(
      blocked.body().message,
      `DELETE /exams/state?subject_id=${subject.id}&mode=default`
    )
    const stillPending = await ExamAttempt.query()
      .where('user_id', user.id)
      .where('id', attemptId)
      .firstOrFail()
    assert.isNull(stillPending.result)
    const scoreBlocked = await Score.query()
      .where('user_id', user.id)
      .where('subject_id', subject.id)
      .first()
    assert.equal(scoreBlocked?.score, scoreBefore?.score)
    const answersBlocked = await Answer.query()
      .where('user_id', user.id)
      .count('* as total')
      .firstOrFail()
    assert.equal(Number(answersBlocked.$extras.total), Number(answersBefore.$extras.total))
    const responses = await Promise.all([
      client.post('/exams/verify').header('authorization', `Bearer ${userToken}`).json(legacy),
      client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json(attempt.verify),
    ])
    // The legacy request is rejected while pending, or starts a new exam if UUID grading wins.
    assert.oneOf(responses[0].status(), [200, 409])
    responses[1].assertStatus(200)
    const scoredExams = responses[0].status() === 200 ? 3 : 2
    const completedState = await ExamState.findOrFail(state.body().id)
    assert.isTrue(completedState.isCompleted)
    assert.equal(completedState.attemptId, attemptId)
    const retry = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(attempt.verify)
    retry.assertStatus(200)
    assert.deepEqual(retry.body(), responses[1].body())
    const lateLegacy = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(legacy)
    lateLegacy.assertStatus(200)
    const scoreAfter = await Score.query()
      .where('user_id', user.id)
      .where('subject_id', subject.id)
      .firstOrFail()
    assert.equal(scoreAfter.score, (scoreBefore?.score ?? 0) + scoredExams * 100)
    const answersAfter = await Answer.query()
      .where('user_id', user.id)
      .count('* as total')
      .firstOrFail()
    assert.equal(
      Number(answersAfter.$extras.total),
      Number(answersBefore.$extras.total) + scoredExams
    )
    const clear = await client
      .delete(`/exams/state?subject_id=${subject.id}&mode=default`)
      .header('authorization', `Bearer ${userToken}`)
    clear.assertStatus(204)
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

  test('non-custom grading and replay ignore penalty, including old hashes', async ({
    client,
    assert,
  }) => {
    const attempt = await mobileAttempt(client)
    const completed = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json({ ...attempt.verify, penalizing_factor: 0.5 })
    completed.assertStatus(200)
    assert.equal(completed.body().score, 100)
    const stored = await ExamAttempt.findByOrFail('id', attempt.id)
    for (const oldHash of [false, true]) {
      if (oldHash) {
        stored.snapshot = { ...stored.snapshot, penalizingFactor: 0.5 }
        stored.requestHash = createHash('sha256')
          .update(
            JSON.stringify({
              subject: subject.id,
              mode: 'default',
              count: 10,
              penalty: 0.5,
              answers: attempt.verify.answers
                .map((item: any) => ({ id: item.question_id, order: 'A' }))
                .sort((a: any, b: any) => a.id - b.id),
            })
          )
          .digest('hex')
        await stored.save()
      }
      const retry = await client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json({ ...attempt.verify, penalizing_factor: 1 })
      retry.assertStatus(200)
      assert.deepEqual(retry.body(), completed.body())
      const changed = await client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json({
          ...attempt.verify,
          answers: attempt.verify.answers.map((item: any) => ({
            ...item,
            selected_option: 'B',
          })),
        })
      changed.assertStatus(409)
    }
  })

  test('custom default penalty survives cloud resume and historical null replay', async ({
    client,
    assert,
  }) => {
    const user = await User.findByOrFail('authSubject', USER_SUB)
    const before = await Answer.query()
      .where('user_id', user.id)
      .where('subject_id', subject.id)
      .where('mode', 'custom')
      .count('* as total')
      .firstOrFail()
    for (const historical of [false, true]) {
      await resetState()
      const id = randomUUID()
      const generated = await client
        .get(`/exams/generate/${subject.id}?mode=custom&n_of_questions=5&attempt_id=${id}`)
        .header('authorization', `Bearer ${userToken}`)
      generated.assertStatus(200)
      const stored = await ExamAttempt.findByOrFail('id', id)
      if (historical) {
        stored.snapshot = { ...stored.snapshot, penalizingFactor: null }
        await stored.save()
      }
      const saved = await client
        .post('/exams/state')
        .header('authorization', `Bearer ${userToken}`)
        .json({
          subject_id: subject.id,
          mode: 'custom',
          attempt_id: id,
          state: {
            version: 2,
            subjectId: subject.id,
            mode: 'custom',
            questionIds: generated.body().map((q: any) => q.id),
            answers: generated.body().map((q: any, i: number) => [q.id, i === 0 ? 'B' : 'A']),
            time: 5,
            currentQuestionIndex: 0,
            n_of_questions: 5,
            penalizing_factor: 0,
          },
        })
      saved.assertStatus(200)
      const resumed = await client
        .get(`/exams/state?subject_id=${subject.id}&mode=custom`)
        .header('authorization', `Bearer ${userToken}`)
      resumed.assertStatus(200)
      const state = resumed.body().state
      const body = {
        subject_id: subject.id,
        mode: state.mode,
        attempt_id: resumed.body().attempt_id,
        n_of_questions: state.n_of_questions,
        penalizing_factor: state.penalizing_factor,
        answers: state.answers.map(([questionId, option]: [number, string]) => ({
          question_id: questionId,
          selected_option: option,
        })),
      }
      const completed = await client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json(body)
      completed.assertStatus(200)
      assert.equal(completed.body().score, 80)
      if (historical) {
        await stored.refresh()
        stored.requestHash = createHash('sha256')
          .update(
            JSON.stringify({
              subject: subject.id,
              mode: 'custom',
              count: 5,
              penalty: null,
              answers: body.answers
                .map((item: any) => ({ id: item.question_id, order: item.selected_option }))
                .sort((a: any, b: any) => a.id - b.id),
            })
          )
          .digest('hex')
        await stored.save()
      } else {
        assert.equal(stored.snapshot.penalizingFactor, 0)
      }
      for (const penalty of [undefined, 0]) {
        const retry = await client
          .post('/exams/verify')
          .header('authorization', `Bearer ${userToken}`)
          .json({ ...body, penalizing_factor: penalty })
        retry.assertStatus(200)
        assert.deepEqual(retry.body(), completed.body())
      }
      const changed = await client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json({ ...body, penalizing_factor: 0.5 })
      changed.assertStatus(409)
      const changedAnswers = await client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json({
          ...body,
          answers: body.answers.map((item: any) => ({ ...item, selected_option: 'A' })),
        })
      changedAnswers.assertStatus(409)
      const count = await Answer.query()
        .where('user_id', stored.userId)
        .where('subject_id', subject.id)
        .where('mode', 'custom')
        .count('* as total')
        .firstOrFail()
      assert.equal(Number(count.$extras.total), Number(before.$extras.total) + (historical ? 2 : 1))
    }
  })

  test('bound cloud saves reject custom configuration changes without replacing progress', async ({
    client,
    assert,
  }) => {
    await resetState()
    const id = randomUUID()
    const generated = await client
      .get(
        `/exams/generate/${subject.id}?mode=custom&n_of_questions=5&penalizing_factor=0.5&attempt_id=${id}`
      )
      .header('authorization', `Bearer ${userToken}`)
    generated.assertStatus(200)
    const body = {
      subject_id: subject.id,
      mode: 'custom',
      attempt_id: id,
      state: {
        version: 2,
        subjectId: subject.id,
        mode: 'custom',
        questionIds: generated.body().map((q: any) => q.id),
        answers: [[generated.body()[0].id, 'B']],
        time: 5,
        currentQuestionIndex: 0,
        n_of_questions: 5,
        penalizing_factor: 0.5,
      },
    }
    const saved = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json(body)
    saved.assertStatus(200)
    const stored = await ExamAttempt.findByOrFail('id', id)
    const activity = stored.updatedAt.toMillis()
    for (const explicit of [true, false]) {
      for (const change of [{ penalizing_factor: 0 }, { n_of_questions: 6 }]) {
        const invalid = await client
          .post('/exams/state')
          .header('authorization', `Bearer ${userToken}`)
          .json({
            ...body,
            attempt_id: explicit ? id : undefined,
            state: { ...body.state, ...change, time: 99 },
          })
        invalid.assertStatus(409)
        const retained = await client
          .get(`/exams/state?subject_id=${subject.id}&mode=custom`)
          .header('authorization', `Bearer ${userToken}`)
        retained.assertStatus(200)
        assert.deepEqual(retained.body(), saved.body())
        await stored.refresh()
        assert.equal(stored.updatedAt.toMillis(), activity)
      }
    }
    const completed = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json({
        subject_id: subject.id,
        mode: 'custom',
        attempt_id: id,
        n_of_questions: 5,
        penalizing_factor: 0.5,
        answers: body.state.questionIds.map((questionId: number, i: number) => ({
          question_id: questionId,
          selected_option: i === 0 ? 'B' : 'A',
        })),
      })
    completed.assertStatus(200)
    assert.equal(completed.body().score, 70)
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
  test('owner-only discard releases the cap and removes only its bound draft', async ({
    client,
    assert,
  }) => {
    await resetState()
    const user = await User.findByOrFail('authSubject', USER_SUB)
    await ExamAttempt.query().where('user_id', user.id).whereNull('result').delete()
    const attempt = await mobileAttempt(client)
    const source = await ExamAttempt.query()
      .where('user_id', user.id)
      .where('id', attempt.id)
      .firstOrFail()
    await db.table('exam_attempts').insert(
      Array.from({ length: 19 }, () => ({
        id: randomUUID(),
        user_id: user.id,
        subject_id: subject.id,
        mode: 'default',
        snapshot: JSON.stringify(source.snapshot),
        created_at: new Date(),
        updated_at: new Date(),
      }))
    )
    const saved = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({
        subject_id: subject.id,
        mode: 'default',
        state: attempt.state,
        attempt_id: attempt.id,
      })
    saved.assertStatus(200)
    const anonymous = await client.delete(`/exams/attempts/${attempt.id}`)
    anonymous.assertStatus(401)
    const other = await client
      .delete(`/exams/attempts/${attempt.id}`)
      .header('authorization', `Bearer ${adminToken}`)
    other.assertStatus(204)
    assert.isNotNull(
      await ExamAttempt.query().where('id', attempt.id).where('user_id', user.id).first()
    )
    const sameId = await client
      .get(`/exams/generate/${subject.id}?attempt_id=${attempt.id}`)
      .header('authorization', `Bearer ${adminToken}`)
    sameId.assertStatus(200)
    const discarded = await client
      .delete(`/exams/attempts/${attempt.id}`)
      .header('authorization', `Bearer ${userToken}`)
    discarded.assertStatus(204)
    const otherStillOwned = await client
      .get(`/exams/attempts/${attempt.id}`)
      .header('authorization', `Bearer ${adminToken}`)
    otherStillOwned.assertStatus(200)
    const repeated = await client
      .delete(`/exams/attempts/${attempt.id}`)
      .header('authorization', `Bearer ${userToken}`)
    repeated.assertStatus(204)
    assert.isNull(await ExamState.find(saved.body().id))
    const verify = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(attempt.verify)
    verify.assertStatus(409)
    const next = await mobileAttempt(client)
    const graded = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(next.verify)
    graded.assertStatus(200)
    const preserved = await client
      .delete(`/exams/attempts/${next.id}`)
      .header('authorization', `Bearer ${userToken}`)
    preserved.assertStatus(409)
    const replay = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json(next.verify)
    replay.assertStatus(200)
    assert.deepEqual(replay.body(), graded.body())
    await ExamAttempt.query().where('user_id', user.id).whereNull('result').delete()
  })

  test('discard of an older attempt preserves newer state and racing grading stays atomic', async ({
    client,
    assert,
  }) => {
    await resetState()
    const old = await mobileAttempt(client)
    const newer = await mobileAttempt(client)
    const saved = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({ subject_id: subject.id, mode: 'default', state: newer.state, attempt_id: newer.id })
    saved.assertStatus(200)
    const removed = await client
      .delete(`/exams/attempts/${old.id}`)
      .header('authorization', `Bearer ${userToken}`)
    removed.assertStatus(204)
    assert.isNotNull(await ExamState.find(saved.body().id))
    const race = await Promise.all([
      client.delete(`/exams/attempts/${newer.id}`).header('authorization', `Bearer ${userToken}`),
      client
        .post('/exams/verify')
        .header('authorization', `Bearer ${userToken}`)
        .json(newer.verify),
    ])
    assert.oneOf(race[0].status(), [204, 409])
    assert.oneOf(race[1].status(), [200, 409])
    assert.isTrue(
      (race[0].status() === 204 && race[1].status() === 409) ||
        (race[0].status() === 409 && race[1].status() === 200)
    )
  })

  test('reordered state preserves its cursor and stored-attempt binding', async ({
    client,
    assert,
  }) => {
    await resetState()
    const attempt = await mobileAttempt(client)
    const ids = [...attempt.state.questionIds].reverse()
    const saved = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({
        subject_id: subject.id,
        mode: 'default',
        attempt_id: attempt.id,
        state: { ...attempt.state, questionIds: ids, currentQuestionIndex: 2 },
      })
    saved.assertStatus(200)
    assert.deepEqual(saved.body().state.questionIds, ids)
    assert.equal(saved.body().state.currentQuestionIndex, 2)
    const legacySave = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({
        subject_id: subject.id,
        mode: 'default',
        state: attempt.state,
      })
    legacySave.assertStatus(200)
    assert.equal(legacySave.body().attempt_id, attempt.id)
    const legacy = await client
      .post('/exams/verify')
      .header('authorization', `Bearer ${userToken}`)
      .json({ ...attempt.verify, attempt_id: undefined })
    legacy.assertStatus(409)
    const changed = await client
      .post('/exams/state')
      .header('authorization', `Bearer ${userToken}`)
      .json({
        subject_id: subject.id,
        mode: 'default',
        attempt_id: attempt.id,
        state: { ...attempt.state, questionIds: ids.slice(1) },
      })
    changed.assertStatus(409)
  })
  test('commit response loss preserves the original error without rollback on a completed transaction', async ({
    client,
    assert,
  }) => {
    await resetState()
    const attempt = await mobileAttempt(client)
    const user = await User.findByOrFail('authSubject', USER_SUB)
    const original = db.transaction
    let rolledBack = false
    db.transaction = (async () => {
      const trx = await original.call(db)
      const commit = trx.commit.bind(trx)
      trx.commit = async () => {
        await commit()
        throw new Error('Commit response lost')
      }
      trx.rollback = async () => {
        rolledBack = true
        throw new Error('Rollback on finished transaction')
      }
      return trx
    }) as typeof db.transaction
    try {
      await assert.rejects(
        () =>
          new ExamVerificationService().verify({
            subject,
            mode: 'default',
            userId: user.id,
            attemptId: attempt.id,
            time: 5,
            nOfQuestions: null,
            penalizingFactor: null,
            answers: attempt.verify.answers,
          }),
        /Commit response lost/
      )
      assert.isFalse(rolledBack)
    } finally {
      db.transaction = original
    }
    const recovered = await client
      .get(`/exams/attempts/${attempt.id}`)
      .header('authorization', `Bearer ${userToken}`)
    recovered.assertStatus(200)
    assert.isNotNull(recovered.body().result)
  })
})
