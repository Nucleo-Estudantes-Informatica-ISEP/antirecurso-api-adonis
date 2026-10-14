import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Recovery from '../../database/migrations/1791590400000_add_exam_attempt_recovery.js'
import Indexes from '../../database/migrations/1791792000000_index_exam_attempt_recovery.js'
import OwnerScope from '../../database/migrations/1791936000000_scope_exam_attempts_to_owner.js'

const id = '11111111-1111-4111-8111-111111111111'

async function isolatedSchema(
  run: (trx: TransactionClientContract, schema: string) => Promise<void>
) {
  const trx = await db.transaction()
  const schema = `exam_migration_${randomUUID().replaceAll('-', '')}`
  try {
    await trx.rawQuery('CREATE SCHEMA ??', [schema])
    await trx.rawQuery('SET LOCAL search_path TO ??', [schema])
    await trx.schema.createTable('users', (table) => table.integer('id').primary())
    await trx.schema.createTable('subjects', (table) => table.integer('id').primary())
    await trx.schema.createTable('exam_states', (table) => {
      table.increments('id')
      table.integer('user_id').notNullable()
    })
    await trx.table('users').insert([{ id: 1 }, { id: 2 }])
    await trx.table('subjects').insert({ id: 1 })
    await new Recovery(trx, 'recovery').execUp()
    await run(trx, schema)
  } finally {
    if (!trx.isCompleted) await trx.rollback()
  }
}

function attempt(userId: number | null) {
  return {
    id,
    user_id: userId,
    subject_id: 1,
    mode: 'default',
    snapshot: JSON.stringify({ questions: [] }),
    created_at: new Date(),
    updated_at: new Date(),
  }
}

test.group('Exam migration data and indexes', () => {
  test('review and state indexes apply, roll back and reapply', async ({ assert }) => {
    await isolatedSchema(async (trx, schema) => {
      await new Indexes(trx, 'indexes').execUp()
      const indexes = await trx.from('pg_indexes').where('schemaname', schema)
      assert.isTrue(indexes.some((index) => index.indexname === 'exam_states_attempt_id_index'))
      assert.include(
        indexes.find((index) => index.indexname === 'exam_attempts_owner_result_idx')!.indexdef,
        "(result ->> 'id'::text)"
      )
      await new Indexes(trx, 'indexes').execDown()
      const reverted = await trx.from('pg_indexes').where('schemaname', schema)
      assert.isFalse(reverted.some((index) => index.indexname === 'exam_attempts_owner_result_idx'))
      await new Indexes(trx, 'indexes').execUp()
      assert.isNotNull(
        await trx
          .from('pg_indexes')
          .where('schemaname', schema)
          .where('indexname', 'exam_attempts_owner_result_idx')
          .first()
      )
    })
  })

  test('owner scope preserves existing snapshots and state through upgrade/rollback/reapply', async ({
    assert,
  }) => {
    await isolatedSchema(async (trx, schema) => {
      await trx.table('exam_attempts').insert(attempt(1))
      await trx.table('exam_states').insert([
        { user_id: 1, attempt_id: id },
        { user_id: 2, attempt_id: null },
      ])
      await new OwnerScope(trx, 'scope').execUp()
      const saved = await trx.from('exam_attempts').where('id', id).firstOrFail()
      assert.isNumber(saved.row_id)
      assert.deepEqual(saved.snapshot, { questions: [] })
      const originalState = await trx.from('exam_states').where('user_id', 1).firstOrFail()
      assert.equal(originalState.attempt_id, id)
      const partial = await trx
        .from('pg_indexes')
        .where('schemaname', schema)
        .where('indexname', 'exam_attempts_unfinished_owner_idx')
        .firstOrFail()
      assert.include(partial.indexdef, 'WHERE (result IS NULL)')
      await new OwnerScope(trx, 'scope').execDown()
      const old = await trx.from('exam_attempts').firstOrFail()
      assert.isUndefined(old.row_id)
      assert.equal(old.id, id)
      await new OwnerScope(trx, 'scope').execUp()
      const scoped = await trx.from('exam_states').where('user_id', 1).firstOrFail()
      const legacy = await trx.from('exam_states').where('user_id', 2).firstOrFail()
      assert.isNull(legacy.attempt_id)
      assert.equal(scoped.attempt_id, id)
      await assert.rejects(
        () =>
          trx.transaction(async (child) => {
            await child.table('exam_states').insert({ user_id: 2, attempt_id: id })
          }),
        /foreign key/
      )
    })
  })

  test('null owners get actionable diagnostics and preserve the old schema/data', async ({
    assert,
  }) => {
    await isolatedSchema(async (trx) => {
      await trx.table('exam_attempts').insert(attempt(null))
      await assert.rejects(
        () => trx.transaction((child) => new OwnerScope(child, 'scope').execUp()),
        /Anonymous exam attempts require reconciliation.*11111111/
      )
      const saved = await trx.from('exam_attempts').firstOrFail()
      assert.isNull(saved.user_id)
      assert.isUndefined(saved.row_id)
      const fk = await trx.rawQuery(
        "SELECT count(*) AS total FROM pg_constraint WHERE conname = 'exam_states_attempt_id_foreign' AND conrelid = 'exam_states'::regclass"
      )
      assert.equal(Number(fk.rows[0].total), 1)
    })
  })

  test('cross-owner state references get actionable diagnostics before key changes', async ({
    assert,
  }) => {
    await isolatedSchema(async (trx) => {
      await trx.table('exam_attempts').insert(attempt(1))
      await trx.table('exam_states').insert({ user_id: 2, attempt_id: id })
      await assert.rejects(
        () => trx.transaction((child) => new OwnerScope(child, 'scope').execUp()),
        /Exam states reference another owner.*11111111/
      )
      const state = await trx.from('exam_states').firstOrFail()
      const oldAttempt = await trx.from('exam_attempts').firstOrFail()
      assert.equal(state.user_id, 2)
      assert.isUndefined(oldAttempt.row_id)
    })
  })

  test('duplicate-UUID rollback names owners and retains the scoped schema and both rows', async ({
    assert,
  }) => {
    await isolatedSchema(async (trx, schema) => {
      await new OwnerScope(trx, 'scope').execUp()
      await trx.table('exam_attempts').insert([attempt(1), attempt(2)])
      await trx.table('exam_states').insert([
        { user_id: 1, attempt_id: id },
        { user_id: 2, attempt_id: id },
      ])
      await assert.rejects(
        () => trx.transaction((child) => new OwnerScope(child, 'scope').execDown()),
        /Duplicate exam UUIDs require reconciliation.*11111111.*1.*2/
      )
      const rows = await trx.from('exam_attempts').where('id', id)
      assert.lengthOf(rows, 2)
      rows.forEach((row) => assert.isNumber(row.row_id))
      assert.lengthOf(await trx.from('exam_states'), 2)
      assert.isNotNull(
        await trx
          .from('pg_indexes')
          .where('schemaname', schema)
          .where('indexname', 'exam_attempts_unfinished_owner_idx')
          .first()
      )
    })
  })
})
