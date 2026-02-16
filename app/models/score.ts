import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Subject from '#models/subject'

export default class Score extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare score: number

  @column()
  declare userId: number

  @column()
  declare subjectId: number

  @column()
  declare showScoreboard: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Subject)
  declare subject: BelongsTo<typeof Subject>
}
