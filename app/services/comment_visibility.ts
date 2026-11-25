import db from '@adonisjs/lucid/services/db'
import type { ChainableContract } from '@adonisjs/lucid/types/querybuilder'

export function visibleComments<T extends ChainableContract>(query: T, viewerId: number) {
  query.whereNull('hiddenAt')
  query.whereNotIn(
    'userId',
    db.from('user_blocks').select('blocked_user_id').where('user_id', viewerId)
  )
  return query
}
