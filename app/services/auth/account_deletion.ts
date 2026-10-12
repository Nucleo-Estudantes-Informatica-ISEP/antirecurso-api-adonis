import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import Note from '#models/note'
import StorageService from '#services/storage_service'
import { UnauthorizedError } from '#services/auth/zitadel_auth_service'
import { lockNoteMutations } from '#services/note_mutation'
import { accountSubjectHash } from '#services/auth/user_identity'

export class SharedNoteError extends Error {}
export class DeletionStorageError extends Error {}

export async function deleteAccount(userId: number, sub: string) {
  await db.transaction(async (trx) => {
    const hash = accountSubjectHash(sub)
    await trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', [hash])
    const user = await User.query().useTransaction(trx).where('id', userId).forUpdate().first()
    if (!user || user.authSubject !== sub)
      throw new UnauthorizedError('Account no longer available')
    const notes = await Note.query().useTransaction(trx).where('userId', userId).forUpdate()
    const uploads = await trx.from('note_uploads').where('user_id', userId)
    const uploadIds = [
      ...new Set(
        [...notes.map((note) => note.uploadId), ...uploads.map((upload) => upload.id)].filter(
          (id): id is string => Boolean(id)
        )
      ),
    ]
    await lockNoteMutations(trx, uploadIds)
    if (uploadIds.length) {
      const shared = await Note.query()
        .useTransaction(trx)
        .whereIn('uploadId', uploadIds)
        .whereNot('userId', userId)
        .first()
      if (shared)
        throw new SharedNoteError(
          'A note file is shared with another account; contact an administrator'
        )
    }
    await trx
      .table('deleted_accounts')
      .insert({ subject_hash: hash, issued_before: Math.floor(Date.now() / 1000) })
      .onConflict('subject_hash')
      .merge()
    // Answers otherwise become anonymous through SET NULL instead of being erased.
    await trx.from('answers').where('user_id', userId).delete()
    user.useTransaction(trx)
    await user.delete()
    if (uploadIds.length) {
      try {
        // shortcut: storage and SQL commit are not atomic; retain metadata on failure, use a durable cleanup job for commit-failure recovery.
        const storage = new StorageService()
        for (const id of uploadIds) await storage.deleteNoteAssets(id)
      } catch {
        throw new DeletionStorageError(
          'File cleanup unavailable; account deletion was not completed'
        )
      }
    }
  })
}
