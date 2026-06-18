import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'practical_problems'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('title').notNullable()
      table.text('description').notNullable()
      table.string('language').notNullable()
      table
        .integer('subject_id')
        .notNullable()
        .references('id')
        .inTable('subjects')
        .onDelete('CASCADE')
      table.integer('time_limit_ms').notNullable()
      table.integer('memory_limit_kb').notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
