import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'revoked_access_tokens'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('token_hash', 64).primary()
      table.bigInteger('expires_at').notNullable().index()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
