import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Subject from '#models/subject'
import Like from '#models/like'

export default class Note extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  @column()
  declare url: string | null

  @column()
  declare description: string | null

  @column()
  declare views: number

  @column()
  declare nPages: number | null

  @column()
  declare uploadId: string | null

  @column()
  declare userId: number

  @column()
  declare subjectId: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @hasMany(() => Like)
  declare likes: HasMany<typeof Like>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Subject)
  declare subject: BelongsTo<typeof Subject>
}
