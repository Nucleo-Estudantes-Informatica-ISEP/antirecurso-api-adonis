import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'question_reports'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.text('reason').nullable()
      table
        .integer('question_id')
        .notNullable()
        .references('id')
        .inTable('questions')
        .onDelete('CASCADE')
      table
        .integer('user_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.dateTime('reviewed_at').nullable()
      table
        .integer('reviewed_by')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.boolean('solved').notNullable().defaultTo(false)

      table.unique(['question_id', 'user_id'])

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}