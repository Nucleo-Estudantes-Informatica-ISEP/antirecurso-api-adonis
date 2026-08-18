import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'exam_states'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .integer('subject_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('subjects')
        .onDelete('CASCADE')
      table.string('mode').notNullable()
      table.jsonb('state').notNullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['user_id', 'subject_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
