import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'questions'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('source', 20).notNullable().defaultTo('REAL_EXAM')
      table.check(
        "source IN ('REAL_EXAM', 'AI_GENERATED', 'MANUAL')",
        {},
        'questions_source_allowed'
      )
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropChecks(['questions_source_allowed'])
      table.dropColumn('source')
    })
  }
}
