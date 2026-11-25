import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.defer(async (client) => {
      await client.rawQuery('LOCK TABLE exam_attempts, exam_states IN ACCESS EXCLUSIVE MODE')
      const anonymous = await client
        .from('exam_attempts')
        .whereNull('user_id')
        .select('id')
        .limit(20)
      if (anonymous.length)
        throw new Error(
          `Anonymous exam attempts require reconciliation: ${JSON.stringify(anonymous)}`
        )
      const mismatched = await client
        .from('exam_states as state')
        .leftJoin('exam_attempts as attempt', 'attempt.id', 'state.attempt_id')
        .whereNotNull('state.attempt_id')
        .whereRaw('(state.user_id IS DISTINCT FROM attempt.user_id OR attempt.id IS NULL)')
        .select('state.id', 'state.user_id', 'state.attempt_id')
        .limit(20)
      if (mismatched.length)
        throw new Error(
          `Exam states reference another owner or missing attempt: ${JSON.stringify(mismatched)}`
        )
      await this.dropAttemptForeignKeys(client)
    })
    this.schema.raw('ALTER TABLE exam_attempts DROP CONSTRAINT exam_attempts_pkey')
    this.schema.raw('ALTER TABLE exam_attempts ALTER COLUMN user_id SET NOT NULL')
    this.schema.raw('ALTER TABLE exam_attempts ADD COLUMN row_id SERIAL PRIMARY KEY')
    this.schema.raw(
      'ALTER TABLE exam_attempts ADD CONSTRAINT exam_attempts_owner_id_unique UNIQUE (user_id, id)'
    )
    this.schema.raw(
      'CREATE INDEX exam_attempts_unfinished_owner_idx ON exam_attempts (user_id) WHERE result IS NULL'
    )
    this.schema.raw(
      'ALTER TABLE exam_states ADD CONSTRAINT exam_states_owner_attempt_foreign FOREIGN KEY (user_id, attempt_id) REFERENCES exam_attempts (user_id, id) ON DELETE CASCADE'
    )
  }

  async down() {
    this.defer(async (client) => {
      await client.rawQuery('LOCK TABLE exam_attempts, exam_states IN ACCESS EXCLUSIVE MODE')
      const duplicates = await client.rawQuery(
        'SELECT id, array_agg(user_id ORDER BY user_id) AS owners FROM exam_attempts GROUP BY id HAVING count(*) > 1 LIMIT 20'
      )
      if (duplicates.rows.length)
        throw new Error(
          `Duplicate exam UUIDs require reconciliation before rollback: ${JSON.stringify(duplicates.rows)}`
        )
      await this.dropAttemptForeignKeys(client)
    })
    this.schema.raw('DROP INDEX exam_attempts_unfinished_owner_idx')
    this.schema.raw('ALTER TABLE exam_attempts DROP COLUMN row_id')
    this.schema.raw('ALTER TABLE exam_attempts ADD PRIMARY KEY (id)')
    this.schema.raw('ALTER TABLE exam_attempts DROP CONSTRAINT exam_attempts_owner_id_unique')
    this.schema.raw('ALTER TABLE exam_attempts ALTER COLUMN user_id DROP NOT NULL')
    this.schema.raw(
      'ALTER TABLE exam_states ADD CONSTRAINT exam_states_attempt_id_foreign FOREIGN KEY (attempt_id) REFERENCES exam_attempts (id) ON DELETE CASCADE'
    )
  }

  private async dropAttemptForeignKeys(client: QueryClientContract) {
    const constraints = await client.rawQuery(
      "SELECT conname FROM pg_constraint WHERE conrelid = 'exam_states'::regclass AND confrelid = 'exam_attempts'::regclass AND contype = 'f'"
    )
    for (const constraint of constraints.rows) {
      await client.rawQuery('ALTER TABLE exam_states DROP CONSTRAINT ??', [constraint.conname])
    }
  }
}
