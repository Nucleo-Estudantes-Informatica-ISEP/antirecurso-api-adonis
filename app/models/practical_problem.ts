import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Subject from '#models/subject'
import TestCase from '#models/test_case'
import PracticalSubmission from '#models/practical_submission'

export default class PracticalProblem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  @column()
  declare description: string

  @column()
  declare language: string

  @column()
  declare subjectId: number

  @column()
  declare timeLimitMs: number

  @column()
  declare memoryLimitKb: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Subject)
  declare subject: BelongsTo<typeof Subject>

  @hasMany(() => TestCase, { foreignKey: 'problemId' })
  declare testCases: HasMany<typeof TestCase>

  @hasMany(() => PracticalSubmission, { foreignKey: 'problemId' })
  declare submissions: HasMany<typeof PracticalSubmission>
}
