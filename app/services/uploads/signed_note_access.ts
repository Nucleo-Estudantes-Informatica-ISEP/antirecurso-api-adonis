import { createHmac, timingSafeEqual } from 'node:crypto'

export function signNoteAccess(secret: string, noteId: number, uploadId: string, expires: number) {
  return createHmac('sha256', secret).update(`${noteId}:${uploadId}:${expires}`).digest('hex')
}

export function verifyNoteAccess(
  secret: string,
  noteId: number,
  uploadId: string,
  expires: number,
  signature: string
) {
  if (
    !Number.isSafeInteger(expires) ||
    expires < Date.now() ||
    expires > Date.now() + 300_000 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false
  const expected = Buffer.from(signNoteAccess(secret, noteId, uploadId, expires), 'hex')
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'))
}

export function signUploadAccess(secret: string, uploadId: string, expires: number) {
  return createHmac('sha256', secret).update(`upload:${uploadId}:${expires}`).digest('hex')
}

export function verifyUploadAccess(
  secret: string,
  uploadId: string,
  expires: number,
  signature: string
) {
  if (
    !Number.isSafeInteger(expires) ||
    expires < Date.now() ||
    expires > Date.now() + 300_000 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false
  return timingSafeEqual(
    Buffer.from(signUploadAccess(secret, uploadId, expires), 'hex'),
    Buffer.from(signature, 'hex')
  )
}
