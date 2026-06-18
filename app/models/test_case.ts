import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import PracticalProblem from '#models/practical_problem'
import SubmissionResult from '#models/submission_result'

export default class TestCase extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare problemId: number

  @column()
  declare input: string | null

  @column()
  declare expectedOutput: string

  @column()
  declare isHidden: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => PracticalProblem, { foreignKey: 'problemId' })
  declare problem: BelongsTo<typeof PracticalProblem>

  @hasMany(() => SubmissionResult, { foreignKey: 'testCaseId' })
  declare results: HasMany<typeof SubmissionResult>
}
