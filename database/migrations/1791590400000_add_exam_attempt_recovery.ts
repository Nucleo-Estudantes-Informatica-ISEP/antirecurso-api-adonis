import { BaseSchema } from '@adonisjs/lucid/schema'
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('exam_attempts', (table) => {
      table.uuid('id').primary()
      table.integer('user_id').nullable().references('id').inTable('users').onDelete('CASCADE')
      table
        .integer('subject_id')
        .notNullable()
        .references('id')
        .inTable('subjects')
        .onDelete('CASCADE')
      table.string('mode').notNullable()
      table.jsonb('snapshot').notNullable()
      table.string('request_hash', 64).nullable()
      table.jsonb('result').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
    this.schema.alterTable('exam_states', (table) => {
      table.integer('revision').notNullable().defaultTo(1)
      table
        .uuid('attempt_id')
        .nullable()
        .references('id')
        .inTable('exam_attempts')
        .onDelete('CASCADE')
    })
  }
  async down() {
    this.schema.alterTable('exam_states', (table) => {
      table.dropColumn('attempt_id')
      table.dropColumn('revision')
    })
    this.schema.dropTable('exam_attempts')
  }
}
