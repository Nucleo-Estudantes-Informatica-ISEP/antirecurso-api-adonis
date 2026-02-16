import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Answer from '#models/answer'
import Question from '#models/question'
import Option from '#models/option'

export default class AnswerQuestion extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare isWrong: boolean

  @column()
  declare answerId: number

  @column()
  declare questionId: number

  @column()
  declare optionId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Question)
  declare question: BelongsTo<typeof Question>

  @belongsTo(() => Answer)
  declare answer: BelongsTo<typeof Answer>

  @belongsTo(() => Option)
  declare option: BelongsTo<typeof Option>
}
