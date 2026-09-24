import { test } from '@japa/runner'
import {
  signNoteAccess,
  verifyNoteAccess,
  signUploadAccess,
  verifyUploadAccess,
} from '#services/uploads/signed_note_access'

test('note and upload links expire and bind to their exact object', ({ assert }) => {
  const expires = Date.now() + 60_000
  const note = signNoteAccess('secret', 7, 'file-a', expires)
  const upload = signUploadAccess('secret', 'file-a', expires)
  assert.isTrue(verifyNoteAccess('secret', 7, 'file-a', expires, note))
  assert.isFalse(verifyNoteAccess('secret', 8, 'file-a', expires, note))
  assert.isFalse(verifyNoteAccess('secret', 7, 'file-a', Date.now() - 1, note))
  assert.isTrue(verifyUploadAccess('secret', 'file-a', expires, upload))
  assert.isFalse(verifyUploadAccess('secret', 'file-b', expires, upload))
})
