import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Subject from '#models/subject'
import QuestionType from '#models/question_type'
import Option from '#models/option'
import Comment from '#models/comment'
import QuestionReport from '#models/question_report'

export default class Question extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare question: string

  @column()
  declare image: string

  @column()
  declare exam: string

  @column()
  declare correctOption: string

  @column()
  declare subjectId: number

  @column()
  declare questionTypeId: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @hasMany(() => Option)
  declare options: HasMany<typeof Option>

  @belongsTo(() => Subject)
  declare subject: BelongsTo<typeof Subject>

  @belongsTo(() => QuestionType)
  declare questionType: BelongsTo<typeof QuestionType>

  @hasMany(() => Comment)
  declare comments: HasMany<typeof Comment>

  @hasMany(() => QuestionReport)
  declare reports: HasMany<typeof QuestionReport>
}
