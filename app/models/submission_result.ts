import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import PracticalSubmission from '#models/practical_submission'
import TestCase from '#models/test_case'

export default class SubmissionResult extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare submissionId: number

  @column()
  declare testCaseId: number

  @column()
  declare verdict: string

  @column()
  declare stdout: string | null

  @column()
  declare stderr: string | null

  @column()
  declare timeMs: number | null

  @column()
  declare memoryKb: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => PracticalSubmission, { foreignKey: 'submissionId' })
  declare submission: BelongsTo<typeof PracticalSubmission>

  @belongsTo(() => TestCase, { foreignKey: 'testCaseId' })
  declare testCase: BelongsTo<typeof TestCase>
}
