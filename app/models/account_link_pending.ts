import { BaseModel, column, hasOne } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { HasOne } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export default class AccountLinkPending extends BaseModel {
  static table = 'account_link_pending'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare authSubject: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @hasOne(() => User)
  declare user: HasOne<typeof User>
}
