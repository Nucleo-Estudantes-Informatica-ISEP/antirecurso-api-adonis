import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Subject from '#models/subject'
import AnswerQuestion from '#models/answer_question'

export default class Answer extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare score: number

  @column()
  declare userId: number | null

  @column()
  declare subjectId: number

  @column()
  declare mode: string

  @column()
  declare time: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Subject)
  declare subject: BelongsTo<typeof Subject>

  @hasMany(() => AnswerQuestion)
  declare questions: HasMany<typeof AnswerQuestion>
}
