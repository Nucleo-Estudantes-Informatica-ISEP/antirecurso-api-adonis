import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'account_link_pending'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('approved_at', { useTz: true }).nullable()
    })
    this.schema.raw(
      'CREATE UNIQUE INDEX account_link_pending_approved_user_unique ON account_link_pending (user_id) WHERE approved_at IS NOT NULL'
    )
  }

  async down() {
    this.schema.raw('DROP INDEX account_link_pending_approved_user_unique')
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('approved_at')
    })
  }
}
