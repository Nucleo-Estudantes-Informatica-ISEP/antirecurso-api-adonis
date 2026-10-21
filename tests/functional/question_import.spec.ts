import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
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

  test('unchanged options retain exact timestamps in updates and audit snapshots', async ({
    assert,
  }) => {
    await db.from('options').where('question_id', question.id).update({
      updated_at: '2026-10-11 10:00:00.123456+00:00',
    })
    for (const metadataOnly of [false, true]) {
      const input = {
        ...entry(),
        ref: metadataOnly ? 'Metadata correction' : 'Initial correction',
        options: [
          { order: 'A', name: 'Before A' },
          { order: 'B', name: 'Changed B' },
        ],
      }
      const report = await importReviewedQuestions(batch([input]), true)
      const change = report.changes[0]
      assert.equal(change.action, 'update')
      assert.deepEqual(change.after.options[0], change.before!.options[0])
      if (metadataOnly) assert.deepEqual(change.after.options, change.before!.options)
      else assert.notEqual(change.after.options[1].updated_at, change.before!.options[1].updated_at)
      const audit = await db
        .from('question_import_batches')
        .where('batch_id', report.batch_id)
        .first()
      assert.deepEqual(audit.report.changes[0].after.options[0], change.before!.options[0])
    }
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

  test('lowercase answers, lowercase orders and mixed-case collisions are rejected without writes', async ({
    assert,
  }) => {
    for (const bad of [
      { ...entry(), correct_option: 'b' },
      {
        ...entry(),
        options: [
          { order: 'a', name: 'Lowercase' },
          { order: 'B', name: 'Correct answer' },
        ],
      },
      {
        ...entry(),
        correct_option: 'A',
        options: [
          { order: 'a', name: 'Lowercase' },
          { order: 'A', name: 'Uppercase' },
        ],
      },
    ]) {
      const input = batch([entry(), bad])
      await assert.rejects(() => importReviewedQuestions(input, true))
      const current = await Question.findOrFail(question.id)
      assert.equal(current.question, 'Before correction')
      assert.equal(current.correctOption, 'A')
      const currentOptions = await Option.query().where('questionId', question.id).orderBy('order')
      assert.deepEqual(
        currentOptions.map((option) => option.order),
        ['A', 'B']
      )
      assert.deepEqual(
        currentOptions.map((option) => option.name),
        ['Before A', 'Before B']
      )
      assert.isNull(
        await db.from('question_import_batches').where('batch_id', input.batch_id).first()
      )
    }
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

  test('identical statements in different exams can be imported and updated', async ({
    assert,
  }) => {
    const first = entry()
    const second = {
      ...entry(),
      question_id: undefined,
      import_key: `${key}:other-exam`,
      exam: `${first.exam}-resit`,
    }
    const inserted = await importReviewedQuestions(batch([first, second]), true)
    assert.equal(inserted.counts.update, 1)
    assert.equal(inserted.counts.insert, 1)
    const updated = await importReviewedQuestions(
      batch([first, { ...second, ref: 'Updated reference' }]),
      true
    )
    assert.equal(updated.counts.unchanged, 1)
    assert.equal(updated.counts.update, 1)
  })

  test('dry-run does not acquire a lock that blocks writers', async ({ assert }) => {
    await db.transaction(async (trx) => {
      await trx.rawQuery('LOCK TABLE questions IN ROW EXCLUSIVE MODE')
      const report = await Promise.race([
        importReviewedQuestions(batch()),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('dry-run blocked by writer')), 2000)
          timer.unref()
        }),
      ])
      assert.equal(report.status, 'ready')
    })
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

  test('large mixed batches use bulk reads/writes across chunk boundaries and repeat unchanged', async ({
    assert,
  }) => {
    const entries = [
      entry(),
      ...Array.from({ length: 500 }, (_, index) => ({
        ...entry(),
        question_id: undefined,
        import_key: `${key}:bulk:${index}`,
        question: `Bulk question ${index}`,
      })),
    ]
    const queries: string[] = []
    const knex = db.connection().getWriteClient()
    const onQuery = (query: { sql: string }) => queries.push(query.sql)
    knex.on('query', onQuery)
    try {
      const input = batch(entries)
      const report = await importReviewedQuestions(input, true)
      assert.equal(report.counts.insert, 500)
      assert.equal(report.counts.update, 1)
      assert.isBelow(queries.length, 40)
      const lock = queries.findIndex((sql) => sql.startsWith('LOCK TABLE'))
      for (const table of ['questions', 'options', 'question_types', 'question_import_batches']) {
        assert.isTrue(queries.slice(0, lock).some((sql) => sql.includes(`"${table}"`)))
      }
      assert.equal(new Set(report.changes.map((change) => change.question_id)).size, 501)
      for (const change of report.changes) {
        assert.equal(change.after.question.id, change.question_id)
        assert.isTrue(
          change.after.options.every((option) => option.question_id === change.question_id)
        )
      }
      const repeat = await importReviewedQuestions(input, true)
      assert.equal(repeat.counts.unchanged, 501)
      queries.length = 0
      const corrected = await importReviewedQuestions(
        batch(
          entries.map((item) => ({
            ...item,
            ref: 'Bulk corrected reference',
            options: item.options.map((option) => ({ ...option, name: `${option.name} updated` })),
          }))
        ),
        true
      )
      assert.equal(corrected.counts.update, 501)
      assert.isBelow(queries.length, 40)
      assert.isTrue(
        corrected.changes.every(
          (change) =>
            change.after.question.ref === 'Bulk corrected reference' &&
            change.after.options.every((option) => option.name!.endsWith(' updated'))
        )
      )
    } finally {
      knex.off('query', onQuery)
    }
  })

  test('apply rechecks admin changes and new duplicates committed after prefetch', async ({
    assert,
  }) => {
    for (const duplicate of [false, true]) {
      const writer = await db.transaction()
      await writer.rawQuery('LOCK TABLE questions IN ROW EXCLUSIVE MODE')
      const knex = db.connection().getWriteClient()
      let requested!: () => void
      const lockRequested = new Promise<void>((resolve) => {
        requested = resolve
      })
      const onQuery = (query: { sql: string }) => {
        if (query.sql.startsWith('LOCK TABLE questions, options')) requested()
      }
      knex.on('query', onQuery)
      const input = batch([{ ...entry(), image: undefined, ref: undefined }])
      const pending = importReviewedQuestions(input, true)
      // Attach rejection handling while waiting for the lock-request event.
      const finishedEarly = pending.then(() => {
        throw new Error('import did not wait for writer')
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      let committed = false
      try {
        await Promise.race([
          lockRequested,
          finishedEarly,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('import did not reach lock')), 5000)
          }),
        ])
        await writer.from('questions').where('id', question.id).update({
          image: 'latest-admin.png',
          ref: 'Latest admin reference',
        })
        await writer
          .from('options')
          .where('id', options[0].id)
          .update({ name: 'Latest admin option' })
        if (duplicate) {
          await writer.table('questions').insert({
            question: entry().question,
            image: '',
            exam: entry().exam,
            correct_option: 'A',
            source: 'REAL_EXAM',
            subject_id: subject.id,
            question_type_id: type.id,
            created_at: new Date(),
            updated_at: new Date(),
          })
        }
        await writer.commit()
        committed = true
        const report = await pending
        assert.equal(report.status, duplicate ? 'blocked' : 'applied')
        if (duplicate) {
          assert.isTrue(
            report.changes[0].problems.some((problem) =>
              problem.includes('duplicate question text')
            )
          )
          assert.isNull(
            await db.from('question_import_batches').where('batch_id', input.batch_id).first()
          )
        } else {
          assert.equal(report.changes[0].before?.options[0].name, 'Latest admin option')
          assert.equal(report.changes[0].after.question.image, 'latest-admin.png')
          assert.equal(report.changes[0].after.question.ref, 'Latest admin reference')
        }
      } finally {
        clearTimeout(timer)
        knex.off('query', onQuery)
        if (!committed) await writer.rollback()
        await pending.catch(() => {})
      }
    }
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
    await assert.rejects(() => importReviewedQuestions(input), /stored records changed/)
    await assert.rejects(() => importReviewedQuestions(input, true), /stored records changed/)
    const current = await Question.findOrFail(question.id)
    assert.equal(current.question, 'Later admin correction')
  })

  test('legacy seeders cannot publish banks in production', async ({ assert }) => {
    const previous = env.get('NODE_ENV')
    env.set('NODE_ENV', 'production')
    try {
      await assert.rejects(() => new QuestionsSeeder(db.connection()).run(), /questions:import/)
      await assert.rejects(() => new AiQuestionsSeeder(db.connection()).run(), /questions:import/)
      assert.isNull(await Subject.findBy('slug', 'dev-fixtures'))
      assert.lengthOf(await Question.query().where('subjectId', subject.id), 1)
    } finally {
      env.set('NODE_ENV', previous)
    }
  })

  test('local db:seed bootstraps synthetic data idempotently without approval or bank imports', async ({
    assert,
  }) => {
    try {
      for (let repeat = 0; repeat < 2; repeat++) {
        await new AiQuestionsSeeder(db.connection()).run()
        await new QuestionsSeeder(db.connection()).run()
      }
      const fixtureSubject = await Subject.findByOrFail('slug', 'dev-fixtures')
      const fixtures = await Question.query().where('subjectId', fixtureSubject.id)
      assert.lengthOf(fixtures, 1)
      assert.equal(fixtures[0].source, 'MANUAL')
      assert.isNull(fixtures[0].review)
      assert.include(fixtures[0].question, '[DEV FIXTURE]')
      const fixtureType = await QuestionType.findOrFail(fixtures[0].questionTypeId)
      assert.equal(fixtureType.subjectId, fixtureSubject.id)
      const fixtureOptions = await Option.query()
        .where('questionId', fixtures[0].id)
        .orderBy('order')
      assert.deepEqual(
        fixtureOptions.map((option) => [option.order, option.name]),
        [
          ['A', '1'],
          ['B', '2'],
        ]
      )
      assert.equal(fixtures[0].correctOption, 'B')
      assert.lengthOf(await Question.query().where('subjectId', subject.id), 1)
      assert.isNull(
        await db
          .from('question_import_batches')
          .whereRaw('report::text LIKE ?', ['%dev-fixture:arithmetic:v1%'])
          .first()
      )
    } finally {
      const fixtureSubject = await Subject.findBy('slug', 'dev-fixtures')
      if (fixtureSubject) await fixtureSubject.delete()
    }
  })
})
