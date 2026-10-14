import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.raw('ALTER TABLE exam_states DROP CONSTRAINT exam_states_attempt_id_foreign')
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
    // Duplicate UUIDs across owners must be reconciled before reverting to a global UUID key.
    this.schema.raw('ALTER TABLE exam_states DROP CONSTRAINT exam_states_owner_attempt_foreign')
    this.schema.raw('DROP INDEX exam_attempts_unfinished_owner_idx')
    this.schema.raw('ALTER TABLE exam_attempts DROP COLUMN row_id')
    this.schema.raw('ALTER TABLE exam_attempts ADD PRIMARY KEY (id)')
    this.schema.raw('ALTER TABLE exam_attempts DROP CONSTRAINT exam_attempts_owner_id_unique')
    this.schema.raw('ALTER TABLE exam_attempts ALTER COLUMN user_id DROP NOT NULL')
    this.schema.raw(
      'ALTER TABLE exam_states ADD CONSTRAINT exam_states_attempt_id_foreign FOREIGN KEY (attempt_id) REFERENCES exam_attempts (id) ON DELETE CASCADE'
    )
  }
}
