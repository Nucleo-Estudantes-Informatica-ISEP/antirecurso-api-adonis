import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import User from '#models/user'
import ExamAttempt from '#models/exam_attempt'
import { UnauthorizedError } from '#services/auth/zitadel_auth_service'
import { UNFINISHED_ATTEMPT_RETENTION_DAYS } from '#services/exams/exam_config'

export async function lockExamOwner(trx: TransactionClientContract, userId: number) {
  // One existing row protects absent state/score rows and the cross-subject cap, before child locks.
  const user = await User.query({ client: trx }).where('id', userId).forUpdate().first()
  if (!user) throw new UnauthorizedError('Account no longer available')
}

export function unfinishedAttemptCutoff() {
  // Preserve the offset when comparing instants in PostgreSQL timestamptz columns.
  return DateTime.local().minus({ days: UNFINISHED_ATTEMPT_RETENTION_DAYS }).toSQL()!
}

export async function pruneUnfinishedAttempts(trx: TransactionClientContract, userId: number) {
  // Caller holds the owner lock; cascading draft deletion follows the same order as discard.
  await ExamAttempt.query({ client: trx })
    .where('user_id', userId)
    .whereNull('result')
    .where('updated_at', '<', unfinishedAttemptCutoff())
    .delete()
}
