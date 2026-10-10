import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import User from '#models/user'
import { UnauthorizedError } from '#services/auth/zitadel_auth_service'

export async function lockNoteMutations(trx: TransactionClientContract) {
  // shortcut: serialize file mutations across workers; use per-asset locking if upload throughput requires it.
  await trx.rawQuery("SELECT pg_advisory_xact_lock(hashtext('antirecurso-note-assets'))")
}

export function withNoteMutation<T>(
  userId: number,
  run: (trx: TransactionClientContract) => Promise<T>
) {
  return db.transaction(async (trx) => {
    await lockNoteMutations(trx)
    if (!(await User.query().useTransaction(trx).where('id', userId).first()))
      throw new UnauthorizedError('Account no longer available')
    return run(trx)
  })
}
