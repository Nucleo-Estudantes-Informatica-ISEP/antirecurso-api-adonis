import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'exam_states'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('is_completed').notNullable().defaultTo(false)
      table.dropUnique(['user_id', 'subject_id'])
      table.unique(['user_id', 'subject_id', 'mode'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique(['user_id', 'subject_id', 'mode'])
      table.unique(['user_id', 'subject_id'])
      table.dropColumn('is_completed')
    })
  }
}
