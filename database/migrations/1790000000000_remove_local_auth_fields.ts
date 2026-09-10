import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.dropTable('password_reset_codes')

    this.schema.alterTable('users', (table) => {
      table.dropColumns('password', 'is_admin', 'remember_token')
    })
  }

  async down() {
    this.schema.alterTable('users', (table) => {
      table.string('password').nullable()
      table.boolean('is_admin').notNullable().defaultTo(false)
      table.string('remember_token').nullable()
    })

    this.schema.createTable('password_reset_codes', (table) => {
      table.increments('id').notNullable()
      table.string('code').notNullable()
      table.boolean('validated').notNullable().defaultTo(false)
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }
}
