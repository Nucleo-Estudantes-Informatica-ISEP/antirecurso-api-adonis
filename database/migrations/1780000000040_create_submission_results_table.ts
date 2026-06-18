import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'submission_results'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('submission_id')
        .notNullable()
        .references('id')
        .inTable('practical_submissions')
        .onDelete('CASCADE')
      table
        .integer('test_case_id')
        .notNullable()
        .references('id')
        .inTable('test_cases')
        .onDelete('CASCADE')
      table.string('verdict').notNullable()
      table.text('stdout').nullable()
      table.text('stderr').nullable()
      table.integer('time_ms').nullable()
      table.integer('memory_kb').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
