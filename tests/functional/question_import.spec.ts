import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import Subject from '#models/subject'
import QuestionType from '#models/question_type'
import Question from '#models/question'
import Option from '#models/option'
import Answer from '#models/answer'
import AnswerQuestion from '#models/answer_question'
import { importReviewedQuestions } from '#services/questions/reviewed_import'
import QuestionsSeeder from '../../database/seeders/questions_seeder.js'
import AiQuestionsSeeder from '../../database/seeders/ai_generated_questions_seeder.js'

test.group('Reviewed question import', (group) => {
  let subject: Subject
  let type: QuestionType
  let question: Question
  let options: Option[]
  let key: string
  const review = {
    status: 'approved',
    reviewer: 'Academic reviewer',
    reviewed_at: '2026-10-14T10:00:00Z',
    reference: 'Subject review #119',
    duplicates_checked: true,
  }
  const entry = () => ({
    import_key: key,
    question_id: question.id,
    subject_id: subject.id,
    question_type_id: type.id,
    exam: 'reviewed-exam',
    source: 'REAL_EXAM',
    question: 'Corrected statement ' + 'x'.repeat(300),
    correct_option: 'B',
    options: [
      { order: 'A', name: 'Corrected option ' + 'x'.repeat(300) },
      { order: 'B', name: 'Correct answer' },
    ],
    review,
    repeated: false,
    in_plan: true,
    ref: 'Lecture p.12',
  })
  const batch = (entries: unknown[] = [entry()]) => ({ batch_id: randomUUID(), questions: entries })

  group.each.setup(async () => {
    key = `test:${randomUUID()}`
    subject = await Subject.create({ name: key, slug: key, year: 2024 })
    type = await QuestionType.create({ name: key, subjectId: subject.id })
    question = await Question.create({
      question: 'Before correction',
      image: 'preserved.png',
      exam: 'reviewed-exam',
      correctOption: 'A',
      source: 'REAL_EXAM',
      subjectId: subject.id,
      questionTypeId: type.id,
    })
    options = await Option.createMany([
      { questionId: question.id, order: 'A', name: 'Before A' },
      { questionId: question.id, order: 'B', name: 'Before B' },
    ])
    return async () => {
      await db
        .from('question_import_batches')
        .whereRaw('report::text LIKE ?', [`%${key}%`])
        .delete()
      await subject.delete()
    }
  })

  test('dry-run reports full before/after without changing questions, options or audit', async ({
    assert,
  }) => {
    const report = await importReviewedQuestions(batch())
    assert.equal(report.status, 'ready')
    assert.equal(report.counts.update, 1)
    assert.equal(report.changes[0].before?.question.question, 'Before correction')
    assert.equal(report.changes[0].after.question.question, entry().question)
    const current = await Question.findOrFail(question.id)
    assert.equal(current.question, 'Before correction')
    const currentOption = await Option.findOrFail(options[0].id)
    assert.equal(currentOption.name, 'Before A')
    assert.isNull(
      await db.from('question_import_batches').where('batch_id', report.batch_id).first()
    )
  })

  test('text edits adopt explicit existing ID, keep option IDs/image and persist all metadata', async ({
    assert,
  }) => {
    const answer = await Answer.create({
      subjectId: subject.id,
      userId: null,
      score: 100,
      mode: 'random',
      time: 10,
    })
    const history = await AnswerQuestion.create({
      answerId: answer.id,
      questionId: question.id,
      optionId: options[0].id,
      isWrong: false,
    })
    const beforeHistory = await db.from('answer_questions').where('id', history.id).first()
    const input = batch()
    const report = await importReviewedQuestions(input, true)
    assert.equal(report.status, 'applied')
    assert.equal(report.changes[0].question_id, question.id)
    const stored = await db.from('questions').where('id', question.id).first()
    assert.equal(stored.question, entry().question)
    assert.equal(stored.image, 'preserved.png')
    assert.equal(stored.import_key, key)
    assert.deepEqual(stored.review, review)
    assert.isFalse(stored.repeated)
    assert.isTrue(stored.in_plan)
    assert.equal(stored.ref, 'Lecture p.12')
    const currentOption = await Option.findOrFail(options[0].id)
    assert.equal(currentOption.name, entry().options[0].name)
    assert.lengthOf(await Question.query().where('subjectId', subject.id), 1)
    const audit = await db.from('question_import_batches').where('batch_id', input.batch_id).first()
    assert.equal(audit.report.changes[0].before.question.image, 'preserved.png')
    assert.equal(audit.report.changes[0].before.options[0].id, options[0].id)
    assert.equal(audit.report.changes[0].after.question.id, question.id)
    const afterHistory = await db.from('answer_questions').where('id', history.id).first()
    assert.deepEqual(afterHistory, beforeHistory)
  })

  test('repeat import is unchanged, including metadata; stable key works after further text edits', async ({
    assert,
  }) => {
    const input = batch()
    await importReviewedQuestions(input, true)
    const repeat = await importReviewedQuestions(input, true)
    assert.equal(repeat.counts.unchanged, 1)
    assert.equal(repeat.counts.insert, 0)
    const corrected = { ...entry(), question: 'Further correction' }
    delete (corrected as { question_id?: number }).question_id
    const next = await importReviewedQuestions(batch([corrected]), true)
    assert.equal(next.counts.update, 1)
    assert.equal(next.changes[0].question_id, question.id)
    assert.lengthOf(await Question.query().where('subjectId', subject.id), 1)
  })

  test('omitted metadata preserves stored flags and reference', async ({ assert }) => {
    await importReviewedQuestions(batch(), true)
    const partial = { ...entry(), ref: undefined, repeated: undefined, in_plan: undefined }
    await importReviewedQuestions(batch([partial]), true)
    const stored = await db.from('questions').where('id', question.id).first()
    assert.equal(stored.ref, 'Lecture p.12')
    assert.isFalse(stored.repeated)
    assert.isTrue(stored.in_plan)
  })

  test('explicit null clears metadata and metadata-only changes update existing rows', async ({
    assert,
  }) => {
    await importReviewedQuestions(batch(), true)
    const report = await importReviewedQuestions(
      batch([{ ...entry(), repeated: null, in_plan: null, ref: null }]),
      true
    )
    assert.equal(report.counts.update, 1)
    const stored = await db.from('questions').where('id', question.id).first()
    assert.isNull(stored.repeated)
    assert.isNull(stored.in_plan)
    assert.isNull(stored.ref)
  })

  test('updates preserve creation timestamps and audit snapshots keep PostgreSQL microseconds', async ({
    assert,
  }) => {
    const timestamp = '2026-10-11 10:00:00.123456+00:00'
    await db
      .from('questions')
      .where('id', question.id)
      .update({ created_at: timestamp, updated_at: timestamp })
    await db
      .from('options')
      .where('question_id', question.id)
      .update({ created_at: timestamp, updated_at: timestamp })
    const report = await importReviewedQuestions(batch(), true)
    assert.equal(report.changes[0].before?.question.created_at, '2026-10-11T10:00:00.123456+00:00')
    assert.equal(report.changes[0].before?.question.updated_at, '2026-10-11T10:00:00.123456+00:00')
    assert.equal(report.changes[0].after.question.created_at, '2026-10-11T10:00:00.123456+00:00')
    assert.equal(
      report.changes[0].before?.options[0].updated_at,
      '2026-10-11T10:00:00.123456+00:00'
    )
    assert.equal(report.changes[0].after.options[0].created_at, '2026-10-11T10:00:00.123456+00:00')
  })

  test('option order comparison is independent of database/text collation', async ({ assert }) => {
    await db.from('options').where('id', options[1].id).update({ order: 'a' })
    const input = batch([
      {
        ...entry(),
        correct_option: 'a',
        options: [
          { order: 'a', name: 'Lowercase' },
          { order: 'A', name: 'Uppercase' },
        ],
      },
    ])
    await importReviewedQuestions(input, true)
    const repeat = await importReviewedQuestions(input, true)
    assert.equal(repeat.counts.unchanged, 1)
  })

  test('new approved questions insert once; duplicate text and keys block entire batch', async ({
    assert,
  }) => {
    const fresh = { ...entry(), import_key: `${key}:new`, question: 'New approved question' }
    delete (fresh as { question_id?: number }).question_id
    const inserted = await importReviewedQuestions(batch([fresh]), true)
    assert.equal(inserted.counts.insert, 1)
    const repeat = await importReviewedQuestions(batch([fresh]), true)
    assert.equal(repeat.counts.unchanged, 1)
    const duplicate = {
      ...fresh,
      import_key: `${key}:duplicate`,
      question: '\n NEW\t APPROVED QUESTION\u00a0 ',
    }
    const blocked = await importReviewedQuestions(batch([entry(), duplicate]), true)
    assert.equal(blocked.status, 'blocked')
    assert.equal(blocked.counts.conflict, 1)
    const current = await Question.findOrFail(question.id)
    assert.equal(current.question, 'Before correction')
    const sameKey = await importReviewedQuestions(batch([entry(), entry()]), true)
    assert.equal(sameKey.status, 'blocked')
  })

  test('missing IDs, foreign types, conflicting identity and option removal never fall back to insert', async ({
    assert,
  }) => {
    for (const bad of [
      { ...entry(), question_id: 2147483647 },
      { ...entry(), question_type_id: 2147483647 },
      {
        ...entry(),
        correct_option: 'A',
        options: [
          { order: 'A', name: 'One' },
          { order: 'C', name: 'Three' },
        ],
      },
    ]) {
      const report = await importReviewedQuestions(batch([bad]), true)
      assert.equal(report.status, 'blocked')
    }
    await importReviewedQuestions(batch(), true)
    const conflicting = { ...entry(), import_key: `${key}:other` }
    const report = await importReviewedQuestions(batch([conflicting]), true)
    assert.equal(report.status, 'blocked')
    assert.lengthOf(await Question.query().where('subjectId', subject.id), 1)
  })

  test('approval, duplicate review, answer format and reused batch IDs are enforced', async ({
    assert,
  }) => {
    for (const bad of [
      { ...entry(), review: { ...review, status: 'pending' } },
      { ...entry(), review: { ...review, reviewer: ' ' } },
      { ...entry(), review: { ...review, reviewed_at: 'not a date' } },
      { ...entry(), review: { ...review, reviewed_at: '2026-02-30T10:00:00Z' } },
      { ...entry(), review: { ...review, reviewed_at: '2026-01-01T10:00:00' } },
      { ...entry(), review: { ...review, reviewed_at: '2099-01-01T10:00:00Z' } },
      { ...entry(), repeated: 'false' },
      { ...entry(), in_plan: 1 },
      { ...entry(), review: { ...review, duplicates_checked: false } },
      { ...entry(), correct_option: 'C' },
      {
        ...entry(),
        options: [
          { order: 'A', name: 'Same' },
          { order: 'B', name: ' same ' },
        ],
      },
    ]) {
      await assert.rejects(() =>
        importReviewedQuestions({ batch_id: randomUUID(), questions: [bad] }, true)
      )
    }
    const input = batch()
    await importReviewedQuestions(input, true)
    await assert.rejects(() =>
      importReviewedQuestions(
        { ...input, questions: [{ ...entry(), question: 'Changed batch' }] },
        true
      )
    )
  })

  test('concurrent imports serialize; one insert and one unchanged, one audit', async ({
    assert,
  }) => {
    const fresh = {
      ...entry(),
      question_id: undefined,
      import_key: `${key}:new`,
      question: 'Concurrent new question',
    }
    const input = batch([fresh])
    const reports = await Promise.all([
      importReviewedQuestions(input, true),
      importReviewedQuestions(input, true),
    ])
    assert.deepEqual(reports.map((report) => report.counts.insert).sort(), [0, 1])
    assert.deepEqual(reports.map((report) => report.counts.unchanged).sort(), [0, 1])
    const audits = await db.from('question_import_batches').where('batch_id', input.batch_id)
    assert.lengthOf(audits, 1)
    assert.lengthOf(await Question.query().where('subjectId', subject.id), 2)
  })

  test('audit failure rolls back all question and option changes', async ({ assert }) => {
    await db.rawQuery(
      "ALTER TABLE question_import_batches ADD CONSTRAINT test_no_inserts CHECK ((report->'counts'->>'insert')::integer = 0) NOT VALID"
    )
    try {
      const fresh = {
        ...entry(),
        question_id: undefined,
        import_key: `${key}:new`,
        question: 'New question',
      }
      const input = batch([entry(), fresh])
      await assert.rejects(() => importReviewedQuestions(input, true), /test_no_inserts/)
      const current = await Question.findOrFail(question.id)
      const currentOption = await Option.findOrFail(options[0].id)
      assert.equal(current.question, 'Before correction')
      assert.equal(currentOption.name, 'Before A')
      assert.lengthOf(await Question.query().where('subjectId', subject.id), 1)
      assert.isNull(
        await db.from('question_import_batches').where('batch_id', input.batch_id).first()
      )
    } finally {
      await db.rawQuery('ALTER TABLE question_import_batches DROP CONSTRAINT test_no_inserts')
    }
  })

  test('old batch cannot overwrite a later admin correction', async ({ assert }) => {
    const input = batch()
    await importReviewedQuestions(input, true)
    await db
      .from('questions')
      .where('id', question.id)
      .update({ question: 'Later admin correction' })
    await assert.rejects(() => importReviewedQuestions(input, true), /stored records changed/)
    const current = await Question.findOrFail(question.id)
    assert.equal(current.question, 'Later admin correction')
  })

  test('legacy seeders cannot publish banks without explicit academic approval', async ({
    assert,
  }) => {
    await assert.rejects(() => new QuestionsSeeder(db.connection()).run(), /questions:import/)
    await assert.rejects(() => new AiQuestionsSeeder(db.connection()).run(), /questions:import/)
    assert.lengthOf(await Question.query().where('subjectId', subject.id), 1)
  })
})
