import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('note_uploads', (table) => {
      table.index(['user_id'])
      table.index(['created_at'])
    })
    this.schema.alterTable('comment_reports', (table) => table.index(['reporter_id']))
    this.schema.alterTable('user_blocks', (table) => table.index(['blocked_user_id']))
  }

  async down() {
    this.schema.alterTable('user_blocks', (table) => table.dropIndex(['blocked_user_id']))
    this.schema.alterTable('comment_reports', (table) => table.dropIndex(['reporter_id']))
    this.schema.alterTable('note_uploads', (table) => {
      table.dropIndex(['created_at'])
      table.dropIndex(['user_id'])
    })
  }
}
