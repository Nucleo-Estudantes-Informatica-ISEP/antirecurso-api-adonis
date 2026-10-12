import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import User from '#models/user'
import { UnauthorizedError } from '#services/auth/zitadel_auth_service'

export async function lockNoteMutations(trx: TransactionClientContract, uploadIds: string[]) {
  for (const id of [...new Set(uploadIds)].sort())
    await trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', [
      `antirecurso-note-asset:${id}`,
    ])
}

export function withNoteMutation<T>(
  userId: number,
  run: (trx: TransactionClientContract) => Promise<T>,
  ownerId = userId
) {
  return db.transaction(async (trx) => {
    const ids = [...new Set([userId, ownerId])].sort((a, b) => a - b)
    const users = await User.query()
      .useTransaction(trx)
      .whereIn('id', ids)
      .orderBy('id')
      .forUpdate()
    if (users.length !== ids.length) throw new UnauthorizedError('Account no longer available')
    return run(trx)
  })
}
