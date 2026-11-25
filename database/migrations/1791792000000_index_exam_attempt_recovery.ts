import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('exam_states', (table) => table.index(['attempt_id']))
    this.schema.raw(
      "CREATE INDEX exam_attempts_owner_result_idx ON exam_attempts (user_id, (result->>'id'))"
    )
  }

  async down() {
    this.schema.raw('DROP INDEX exam_attempts_owner_result_idx')
    this.schema.alterTable('exam_states', (table) => table.dropIndex(['attempt_id']))
  }
}
