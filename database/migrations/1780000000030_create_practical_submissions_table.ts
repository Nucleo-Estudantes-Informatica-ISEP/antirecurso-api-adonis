import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'practical_submissions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('session_id')
        .nullable()
        .references('id')
        .inTable('practical_sessions')
        .onDelete('CASCADE')
      table
        .integer('problem_id')
        .notNullable()
        .references('id')
        .inTable('practical_problems')
        .onDelete('CASCADE')
      table.text('source_code').notNullable()
      table.string('status').notNullable().defaultTo('queued')
      table.timestamp('submitted_at').notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
