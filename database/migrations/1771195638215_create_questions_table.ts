import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'questions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('question').notNullable()
      table.string('image').notNullable()
      table.string('correct_option').notNullable()
      table.string('exam').notNullable()
      table
        .integer('subject_id')
        .notNullable()
        .references('id')
        .inTable('subjects')
        .onDelete('CASCADE')
      table
        .integer('question_type_id')
        .notNullable()
        .references('id')
        .inTable('question_types')
        .onDelete('CASCADE')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}