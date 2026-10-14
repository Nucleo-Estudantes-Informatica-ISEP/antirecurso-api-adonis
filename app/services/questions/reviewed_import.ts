import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { DateTime } from 'luxon'
import vine from '@vinejs/vine'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { QUESTION_SOURCES } from '#services/questions/question_source'

const importValidator = vine.compile(
  vine.object({
    batch_id: vine.string().trim().minLength(1).maxLength(160),
    questions: vine
      .array(
        vine.object({
          import_key: vine.string().trim().minLength(1).maxLength(160),
          question_id: vine.number().positive().withoutDecimals().optional(),
          subject_id: vine.number().positive().withoutDecimals(),
          question_type_id: vine.number().positive().withoutDecimals(),
          exam: vine.string().maxLength(255),
          image: vine.string().maxLength(255).optional(),
          source: vine.enum(QUESTION_SOURCES),
          question: vine.string().minLength(1),
          correct_option: vine.string().regex(/^[A-Za-z0-9]$/),
          options: vine
            .array(
              vine.object({
                order: vine.string().regex(/^[A-Za-z0-9]$/),
                name: vine.string().minLength(1),
              })
            )
            .minLength(2)
            .maxLength(9),
          review: vine.object({
            status: vine.literal('approved'),
            reviewer: vine.string().trim().minLength(1),
            reviewed_at: vine.string().trim().minLength(1),
            reference: vine.string().trim().minLength(1),
            duplicates_checked: vine.literal(true),
          }),
          repeated: vine.boolean({ strict: true }).nullable().optional(),
          in_plan: vine.boolean({ strict: true }).nullable().optional(),
          ref: vine.string().nullable().optional(),
        })
      )
      .minLength(1),
  })
)

type QuestionRow = {
  id: number
  question: string
  image: string
  exam: string
  correct_option: string
  source: string
  subject_id: number
  question_type_id: number
  import_key: string | null
  review: unknown
  repeated: boolean | null
  in_plan: boolean | null
  ref: string | null
  created_at: string
  updated_at: string
}
type OptionRow = {
  id: number
  question_id: number
  order: string
  name: string
  created_at: string
  updated_at: string
}
type Snapshot = { question: Partial<QuestionRow>; options: Partial<OptionRow>[] }
type Action = 'insert' | 'update' | 'unchanged' | 'conflict'
export type ImportReport = {
  batch_id: string
  digest: string
  status: 'ready' | 'blocked' | 'applied'
  counts: Record<Action, number>
  changes: {
    import_key: string
    question_id?: number
    action: Action
    problems: string[]
    before: Snapshot | null
    after: Snapshot
  }[]
}

const normalizedText = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()

async function snapshot(trx: TransactionClientContract, id: number): Promise<Snapshot> {
  // PostgreSQL JSON preserves timestamp microseconds that JavaScript Date discards.
  const row = await trx
    .from('questions')
    .where('id', id)
    .select(trx.raw('to_jsonb(questions) AS record'))
    .firstOrFail()
  const options = await trx
    .from('options')
    .where('question_id', id)
    .select(trx.raw('to_jsonb(options) AS record'))
    .orderBy('order')
    .orderBy('id')
  return {
    question: row.record,
    options: options.map((option) => option.record),
  }
}

/** Dry-run is the default. Approval evidence is supplied by a trusted academic operator. */
export async function importReviewedQuestions(
  input: unknown,
  apply = false
): Promise<ImportReport> {
  const data = await importValidator.validate(input)
  for (const entry of data.questions) {
    if (!entry.question.trim() || entry.options.some((option) => !option.name.trim())) {
      throw new Error(`${entry.import_key}: question and option text must not be blank`)
    }
    const reviewedAt = DateTime.fromISO(entry.review.reviewed_at, { setZone: true })
    if (
      !/^\d{4}-\d{2}-\d{2}T/.test(entry.review.reviewed_at) ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(entry.review.reviewed_at) ||
      !reviewedAt.isValid ||
      reviewedAt.toMillis() > Date.now()
    ) {
      throw new Error(`${entry.import_key}: reviewed_at must be a past ISO timestamp`)
    }
    const orders = entry.options.map((option) => option.order)
    if (
      !orders.includes(entry.correct_option) ||
      new Set(orders).size !== orders.length ||
      new Set(entry.options.map((option) => normalizedText(option.name))).size !== orders.length
    ) {
      throw new Error(
        `${entry.import_key}: options must have unique orders/text and contain correct_option`
      )
    }
  }
  const digest = createHash('sha256').update(JSON.stringify(data)).digest('hex')

  return db.transaction(async (trx) => {
    // Serialize imports with all question/option writers, including admin edits.
    await trx.rawQuery(
      'LOCK TABLE questions, options, question_import_batches IN SHARE ROW EXCLUSIVE MODE'
    )
    const previousBatch = await trx
      .from('question_import_batches')
      .where('batch_id', data.batch_id)
      .first()
    if (previousBatch && previousBatch.digest !== digest) {
      throw new Error('batch_id already applied with different content; use a new batch_id')
    }
    const report: ImportReport = {
      batch_id: data.batch_id,
      digest,
      status: 'ready',
      counts: { insert: 0, update: 0, unchanged: 0, conflict: 0 },
      changes: [],
    }
    const seenKeys = new Set<string>()
    const seenIds = new Set<number>()
    const seenTexts = new Set<string>()
    const storedTexts = new Map<string, number[]>()
    const rows = await trx
      .from('questions')
      .whereIn('subject_id', [...new Set(data.questions.map((entry) => entry.subject_id))])
      .select('id', 'subject_id', 'question')
    for (const row of rows) {
      const textKey = `${row.subject_id}:${normalizedText(row.question)}`
      storedTexts.set(textKey, [...(storedTexts.get(textKey) ?? []), row.id])
    }

    for (const entry of data.questions) {
      const problems: string[] = []
      const byKey: QuestionRow | undefined = await trx
        .from('questions')
        .where('import_key', entry.import_key)
        .first()
      const existing: QuestionRow | undefined = entry.question_id
        ? await trx.from('questions').where('id', entry.question_id).first()
        : byKey
      if (entry.question_id && !existing)
        problems.push('question_id does not exist; cannot insert as fallback')
      if (byKey && existing?.id !== byKey.id)
        problems.push('import_key belongs to another question')
      if (existing?.import_key && existing.import_key !== entry.import_key)
        problems.push('question already has a different import_key')
      if (existing && existing.subject_id !== entry.subject_id)
        problems.push('question belongs to another subject')
      const type = await trx
        .from('question_types')
        .where('id', entry.question_type_id)
        .where('subject_id', entry.subject_id)
        .first()
      if (!type) problems.push('question_type_id does not belong to subject_id')
      if (seenKeys.has(entry.import_key)) problems.push('duplicate import_key in batch')
      seenKeys.add(entry.import_key)
      if (existing && seenIds.has(existing.id)) problems.push('question appears twice in batch')
      if (existing) seenIds.add(existing.id)
      const textKey = `${entry.subject_id}:${normalizedText(entry.question)}`
      if (seenTexts.has(textKey)) problems.push('duplicate question text in batch')
      seenTexts.add(textKey)
      const duplicateId = storedTexts.get(textKey)?.find((id) => id !== existing?.id)
      if (duplicateId)
        problems.push(
          `duplicate question text matches question_id ${duplicateId}; map/review existing records first`
        )

      const before = existing ? await snapshot(trx, existing.id) : null
      const attributes = {
        import_key: entry.import_key,
        subject_id: entry.subject_id,
        question_type_id: entry.question_type_id,
        question: entry.question,
        exam: entry.exam,
        source: entry.source,
        correct_option: entry.correct_option,
        image: entry.image ?? existing?.image ?? '',
        review: entry.review,
        repeated: entry.repeated === undefined ? (existing?.repeated ?? null) : entry.repeated,
        in_plan: entry.in_plan === undefined ? (existing?.in_plan ?? null) : entry.in_plan,
        ref: entry.ref === undefined ? (existing?.ref ?? null) : entry.ref,
      }
      const after: Snapshot = {
        question: { ...before?.question, ...attributes },
        options: [...entry.options]
          .sort((a, b) => a.order.localeCompare(b.order))
          .map((option) => ({
            ...before?.options.find((stored) => stored.order === option.order),
            ...option,
          })),
      }
      if (
        before &&
        !isDeepStrictEqual(
          before.options.map((option) => option.order).sort(),
          entry.options.map((option) => option.order).sort()
        )
      ) {
        problems.push(
          'existing option orders/count cannot change; preserve option IDs and exam history'
        )
      }
      const changed =
        !existing ||
        Object.entries(attributes).some(
          ([field, value]) => !isDeepStrictEqual(existing[field as keyof QuestionRow], value)
        ) ||
        after.options.some(
          (option) =>
            option.name !== before?.options.find((stored) => stored.order === option.order)?.name
        )
      const action: Action = problems.length
        ? 'conflict'
        : !existing
          ? 'insert'
          : changed
            ? 'update'
            : 'unchanged'
      report.changes.push({
        import_key: entry.import_key,
        question_id: existing?.id,
        action,
        problems,
        before,
        after,
      })
      report.counts[action]++
    }

    if (report.counts.conflict) {
      report.status = 'blocked'
      return report
    }
    if (!apply) return report
    // Reusing a committed batch is only a no-op. Never replay it over later corrections.
    if (previousBatch && (report.counts.insert || report.counts.update)) {
      throw new Error(
        'batch_id already applied; stored records changed since then; review a new batch'
      )
    }

    for (const change of report.changes) {
      if (change.action === 'unchanged') continue
      const now = new Date()
      if (change.action === 'insert') {
        const [row] = await trx
          .table('questions')
          .insert({ ...change.after.question, created_at: now, updated_at: now })
          .returning('id')
        change.question_id = row.id
        await trx.table('options').insert(
          change.after.options.map((option) => ({
            ...option,
            question_id: row.id,
            created_at: now,
            updated_at: now,
          }))
        )
      } else {
        const attributes = { ...change.after.question }
        delete attributes.id
        delete attributes.created_at
        delete attributes.updated_at
        await trx
          .from('questions')
          .where('id', change.question_id!)
          .update({ ...attributes, updated_at: now })
        for (const option of change.after.options) {
          await trx
            .from('options')
            .where('id', option.id!)
            .update({ name: option.name, updated_at: now })
        }
      }
      change.after = await snapshot(trx, change.question_id!)
    }
    report.status = 'applied'
    if (!previousBatch) {
      await trx.table('question_import_batches').insert({
        batch_id: data.batch_id,
        digest,
        report: JSON.stringify(report),
        applied_at: new Date(),
      })
    }
    return report
  })
}
