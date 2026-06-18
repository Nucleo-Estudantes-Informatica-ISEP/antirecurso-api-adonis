import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'test_cases'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('problem_id')
        .notNullable()
        .references('id')
        .inTable('practical_problems')
        .onDelete('CASCADE')
      table.text('input').nullable()
      table.text('expected_output').notNullable()
      table.boolean('is_hidden').notNullable().defaultTo(false)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
