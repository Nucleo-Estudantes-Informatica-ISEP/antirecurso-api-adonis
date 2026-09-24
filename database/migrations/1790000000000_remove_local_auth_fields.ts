import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Retain legacy reset records copied from production for migration verification.

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
  }
}
