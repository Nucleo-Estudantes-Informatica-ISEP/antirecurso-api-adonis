import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import Score from '#models/score'
import Answer from '#models/answer'
import QuestionReport from '#models/question_report'

export default class User extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare email: string

  @column.dateTime()
  declare emailVerifiedAt: DateTime | null

  @column({ serializeAs: null })
  declare password: string

  @column()
  declare isAdmin: boolean

  @column({ serializeAs: null })
  declare rememberToken: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @hasMany(() => Score)
  declare scores: HasMany<typeof Score>

  @hasMany(() => Answer)
  declare answers: HasMany<typeof Answer>

  @hasMany(() => QuestionReport)
  declare questionReports: HasMany<typeof QuestionReport>
}
