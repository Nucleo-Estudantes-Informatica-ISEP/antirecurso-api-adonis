import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('questions', (table) => {
      table.text('question').notNullable().alter()
      table.string('import_key', 160).nullable().unique()
      table.jsonb('review').nullable()
      table.boolean('repeated').nullable()
      table.boolean('in_plan').nullable()
      table.text('ref').nullable()
    })
    this.schema.alterTable('options', (table) => {
      table.text('name').notNullable().alter()
    })
    this.schema.createTable('question_import_batches', (table) => {
      table.string('batch_id', 160).primary()
      table.string('digest', 64).notNullable()
      table.jsonb('report').notNullable()
      table.timestamp('applied_at', { useTz: true }).notNullable()
    })
  }

  async down() {
    // Keep text columns: rollback must not truncate published content.
    this.schema.dropTable('question_import_batches')
    this.schema.alterTable('questions', (table) => {
      table.dropColumn('import_key')
      table.dropColumn('review')
      table.dropColumn('repeated')
      table.dropColumn('in_plan')
      table.dropColumn('ref')
    })
  }
}
