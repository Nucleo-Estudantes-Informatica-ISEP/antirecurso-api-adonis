import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'answer_questions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('answer_id')
        .notNullable()
        .references('id')
        .inTable('answers')
        .onDelete('CASCADE')
      table
        .integer('question_id')
        .notNullable()
        .references('id')
        .inTable('questions')
        .onDelete('CASCADE')
      table
        .integer('option_id')
        .nullable()
        .references('id')
        .inTable('options')
        .onDelete('SET NULL')
      table.boolean('is_wrong').notNullable().defaultTo(true)

      table.unique(['answer_id', 'question_id'])

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
