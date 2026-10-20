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
          correct_option: vine.string().regex(/^[A-Z0-9]$/),
          options: vine
            .array(
              vine.object({
                order: vine.string().regex(/^[A-Z0-9]$/),
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

async function snapshots(trx: TransactionClientContract, ids: number[]) {
  const result = new Map<number, Snapshot>()
  if (!ids.length) return result
  // PostgreSQL JSON preserves timestamp microseconds that JavaScript Date discards.
  const rows = await trx
    .from('questions')
    .whereIn('id', ids)
    .select(trx.raw('to_jsonb(questions) AS record'))
  const options = await trx
    .from('options')
    .whereIn('question_id', ids)
    .select(trx.raw('to_jsonb(options) AS record'))
    .orderBy('order')
    .orderBy('id')
  for (const row of rows) result.set(row.record.id, { question: row.record, options: [] })
  for (const option of options) result.get(option.record.question_id)!.options.push(option.record)
  return result
}

/** Dry-run is the default. Review fields are unauthenticated operator-supplied notes. */
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
    const keys = data.questions.map((entry) => entry.import_key)
    const ids = data.questions.flatMap((entry) => (entry.question_id ? [entry.question_id] : []))
    const subjects = [...new Set(data.questions.map((entry) => entry.subject_id))]
    const load = async () => {
      const identities: QuestionRow[] = await trx
        .from('questions')
        .whereIn('import_key', keys)
        .orWhereIn('id', ids)
      return {
        identities,
        snapshots: await snapshots(
          trx,
          identities.map((row) => row.id)
        ),
        types: await trx.from('question_types').whereIn(
          'id',
          data.questions.map((entry) => entry.question_type_id)
        ),
        texts: await trx
          .from('questions')
          .whereIn('subject_id', subjects)
          .select('id', 'subject_id', 'exam', 'question'),
        previousBatch: await trx
          .from('question_import_batches')
          .where('batch_id', data.batch_id)
          .first(),
      }
    }
    const plan = (state: Awaited<ReturnType<typeof load>>): ImportReport => {
      const byKeys = new Map(state.identities.map((row) => [row.import_key, row]))
      const byIds = new Map(state.identities.map((row) => [row.id, row]))
      const types = new Map(state.types.map((row) => [row.id, row.subject_id]))
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
      for (const row of state.texts) {
        const textKey = JSON.stringify([row.subject_id, row.exam, normalizedText(row.question)])
        storedTexts.set(textKey, [...(storedTexts.get(textKey) ?? []), row.id])
      }

      for (const entry of data.questions) {
        const problems: string[] = []
        const byKey = byKeys.get(entry.import_key)
        const existing = entry.question_id ? byIds.get(entry.question_id) : byKey
        if (entry.question_id && !existing)
          problems.push('question_id does not exist; cannot insert as fallback')
        if (byKey && existing?.id !== byKey.id)
          problems.push('import_key belongs to another question')
        if (existing?.import_key && existing.import_key !== entry.import_key)
          problems.push('question already has a different import_key')
        if (existing && existing.subject_id !== entry.subject_id)
          problems.push('question belongs to another subject')
        if (types.get(entry.question_type_id) !== entry.subject_id)
          problems.push('question_type_id does not belong to subject_id')
        if (seenKeys.has(entry.import_key)) problems.push('duplicate import_key in batch')
        seenKeys.add(entry.import_key)
        if (existing && seenIds.has(existing.id)) problems.push('question appears twice in batch')
        if (existing) seenIds.add(existing.id)
        const textKey = JSON.stringify([
          entry.subject_id,
          entry.exam,
          normalizedText(entry.question),
        ])
        if (seenTexts.has(textKey)) problems.push('duplicate question text in batch')
        seenTexts.add(textKey)
        const duplicateId = storedTexts.get(textKey)?.find((id) => id !== existing?.id)
        if (duplicateId)
          problems.push(
            `duplicate question text matches question_id ${duplicateId}; map/review existing records first`
          )

        const before = existing ? state.snapshots.get(existing.id)! : null
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
      return report
    }
    const validateReplay = (state: Awaited<ReturnType<typeof load>>, report: ImportReport) => {
      if (state.previousBatch && state.previousBatch.digest !== digest) {
        throw new Error('batch_id already applied with different content; use a new batch_id')
      }
      // Reusing a committed batch is only a no-op. Never replay it over later corrections.
      if (
        state.previousBatch &&
        report.status !== 'blocked' &&
        (report.counts.insert || report.counts.update)
      ) {
        throw new Error(
          'batch_id already applied; stored records changed since then; review a new batch'
        )
      }
    }
    // Plan without blocking admin writers, then bulk re-check under the lock.
    let state = await load()
    let report = plan(state)
    if (!apply) {
      validateReplay(state, report)
      return report
    }
    await trx.rawQuery(
      'LOCK TABLE questions, options, question_import_batches, question_types IN SHARE ROW EXCLUSIVE MODE'
    )
    const current = await load()
    if (!isDeepStrictEqual(state, current)) report = plan(current)
    state = current
    validateReplay(state, report)
    if (report.status === 'blocked') return report

    const changed = report.changes.filter((change) => change.action !== 'unchanged')
    // Bounded bulk writes avoid one round trip per question/option while writers wait.
    for (let offset = 0; offset < changed.length; offset += 500) {
      const chunk = changed.slice(offset, offset + 500)
      const now = new Date()
      const inserts = chunk.filter((change) => change.action === 'insert')
      if (inserts.length) {
        const rows = await trx
          .table('questions')
          .insert(
            inserts.map((change) => ({
              ...change.after.question,
              created_at: now,
              updated_at: now,
            }))
          )
          .returning(['id', 'import_key'])
        const insertedIds = new Map(rows.map((row) => [row.import_key, row.id]))
        for (const change of inserts) change.question_id = insertedIds.get(change.import_key)!
        await trx.table('options').insert(
          inserts.flatMap((change) =>
            change.after.options.map((option) => ({
              ...option,
              question_id: change.question_id,
              created_at: now,
              updated_at: now,
            }))
          )
        )
      }
      const updates = chunk.filter((change) => change.action === 'update')
      if (updates.length) {
        await trx.rawQuery(
          `
          UPDATE questions AS q SET
            import_key = v.import_key, subject_id = v.subject_id,
            question_type_id = v.question_type_id, question = v.question, exam = v.exam,
            source = v.source, correct_option = v.correct_option, image = v.image,
            review = v.review, repeated = v.repeated, in_plan = v.in_plan, ref = v.ref,
            updated_at = v.updated_at
          FROM jsonb_populate_recordset(NULL::questions, ?::jsonb) AS v
          WHERE q.id = v.id
        `,
          [JSON.stringify(updates.map((change) => ({ ...change.after.question, updated_at: now })))]
        )
        await trx.rawQuery(
          `
          UPDATE options AS o SET name = v.name, updated_at = v.updated_at
          FROM jsonb_populate_recordset(NULL::options, ?::jsonb) AS v
          WHERE o.id = v.id
        `,
          [
            JSON.stringify(
              updates.flatMap((change) =>
                change.after.options.map((option) => ({ ...option, updated_at: now }))
              )
            ),
          ]
        )
      }
    }
    const after = await snapshots(
      trx,
      changed.map((change) => change.question_id!)
    )
    for (const change of changed) change.after = after.get(change.question_id!)!
    report.status = 'applied'
    if (!state.previousBatch) {
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
