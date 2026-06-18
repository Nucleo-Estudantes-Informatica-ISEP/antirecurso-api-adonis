import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'practical_sessions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('user_id').nullable().references('id').inTable('users').onDelete('SET NULL')
      table
        .integer('subject_id')
        .notNullable()
        .references('id')
        .inTable('subjects')
        .onDelete('CASCADE')
      table.timestamp('started_at').notNullable()
      table.timestamp('completed_at').nullable()
      table.integer('score').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
