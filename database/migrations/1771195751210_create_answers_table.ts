import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'answers'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('score').notNullable()
      table.integer('user_id').nullable().references('id').inTable('users').onDelete('SET NULL')
      table
        .integer('subject_id')
        .notNullable()
        .references('id')
        .inTable('subjects')
        .onDelete('CASCADE')
      table.string('mode').notNullable().defaultTo('random')
      table.integer('time').nullable()
      table.check('time >= 0', {}, 'answers_time_nonneg')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
