import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import PracticalSession from '#models/practical_session'
import PracticalProblem from '#models/practical_problem'
import SubmissionResult from '#models/submission_result'

export default class PracticalSubmission extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare sessionId: number | null

  @column()
  declare problemId: number

  @column()
  declare sourceCode: string

  @column()
  declare status: string

  @column.dateTime()
  declare submittedAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => PracticalSession, { foreignKey: 'sessionId' })
  declare session: BelongsTo<typeof PracticalSession>

  @belongsTo(() => PracticalProblem, { foreignKey: 'problemId' })
  declare problem: BelongsTo<typeof PracticalProblem>

  @hasMany(() => SubmissionResult, { foreignKey: 'submissionId' })
  declare results: HasMany<typeof SubmissionResult>
}
