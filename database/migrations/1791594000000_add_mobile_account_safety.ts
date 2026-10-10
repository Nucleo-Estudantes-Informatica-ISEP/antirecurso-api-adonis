import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('comments', (table) => {
      table.timestamp('hidden_at').nullable()
    })
    this.schema.createTable('user_blocks', (table) => {
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table
        .integer('blocked_user_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.primary(['user_id', 'blocked_user_id'])
      table.check('user_id <> blocked_user_id')
    })
    this.schema.createTable('comment_reports', (table) => {
      table.increments('id')
      table
        .integer('comment_id')
        .notNullable()
        .references('id')
        .inTable('comments')
        .onDelete('CASCADE')
      table
        .integer('reporter_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.text('reason').notNullable()
      table.string('status').notNullable().defaultTo('pending')
      table.check("status IN ('pending', 'dismissed', 'removed')")
      table.integer('reviewed_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('reviewed_at').nullable()
      table.timestamp('created_at').notNullable()
      table.unique(['comment_id', 'reporter_id'])
      table.index(['status', 'created_at'])
    })
    this.schema.createTable('deleted_accounts', (table) => {
      table.string('subject_hash', 64).primary()
      table.bigInteger('issued_before').notNullable()
    })
    this.schema.createTable('note_uploads', (table) => {
      table.uuid('id').primary()
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.timestamp('created_at').notNullable()
    })
  }
  async down() {
    this.schema.dropTable('note_uploads')
    this.schema.dropTable('deleted_accounts')
    this.schema.dropTable('comment_reports')
    this.schema.dropTable('user_blocks')
    this.schema.alterTable('comments', (table) => table.dropColumn('hidden_at'))
  }
}
