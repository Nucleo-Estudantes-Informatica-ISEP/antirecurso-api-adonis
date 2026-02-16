import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import Score from '#models/score'
import Answer from '#models/answer'
import QuestionReport from '#models/question_report'

const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['email'],
  passwordColumnName: 'password',
})

export default class User extends compose(BaseModel, AuthFinder) {
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

  @column()
  declare rememberToken: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasMany(() => Score)
  declare scores: HasMany<typeof Score>

  @hasMany(() => Answer)
  declare answers: HasMany<typeof Answer>

  @hasMany(() => QuestionReport)
  declare questionReports: HasMany<typeof QuestionReport>
}