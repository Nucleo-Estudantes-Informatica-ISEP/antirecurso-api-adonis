import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Question from '#models/question'
import User from '#models/user'

export default class QuestionReport extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare reason: string | null

  @column()
  declare questionId: number

  @column()
  declare userId: number

  @column.dateTime()
  declare reviewedAt: DateTime | null

  @column()
  declare reviewedBy: number | null

  @column()
  declare solved: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Question)
  declare question: BelongsTo<typeof Question>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'reviewedBy' })
  declare reviewer: BelongsTo<typeof User>
}
