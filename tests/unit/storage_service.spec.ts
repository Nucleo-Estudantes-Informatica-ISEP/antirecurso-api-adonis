import { test } from '@japa/runner'
import { Readable } from 'node:stream'
import StorageService from '#services/storage_service'

function storage(send: (command: unknown) => Promise<unknown>) {
  const service = new StorageService()
  Object.defineProperty(service, 'client', { value: { send } })
  Object.defineProperty(service, 'bucket', { value: 'isolated-test-bucket' })
  return service
}

test('file cleanup tolerates 404 for each path, including retries, but retains other failures', async ({
  assert,
}) => {
  let calls = 0
  const service = storage(async () => {
    calls++
    throw { $metadata: { httpStatusCode: 404 } }
  })
  await service.deleteNoteAssets('test')
  await service.deleteNoteAssets('test')
  assert.equal(calls, 4)
  const failed = storage(async () => {
    throw new Error('Storage unavailable')
  })
  await assert.rejects(() => failed.deleteNoteAssets('test'), /Storage unavailable/)
})

test('reading upload bodies preserves PDF, declared-length and size validation before storage writes', async ({
  assert,
}) => {
  const service = storage(async () => {
    assert.fail('Reading a body must not write storage')
  })
  const pdf = Buffer.from('%PDF-test')
  const body = await service.readNoteUpload(Readable.from([pdf]), 'application/pdf', pdf.length)
  assert.deepEqual(body, pdf)
  await assert.rejects(
    () => service.readNoteUpload(Readable.from([pdf]), 'application/pdf', pdf.length + 1),
    /length does not match/
  )
  await assert.rejects(
    () => service.readNoteUpload(Readable.from([pdf]), 'text/html', pdf.length),
    /application\/pdf/
  )
  await assert.rejects(
    () => service.readNoteUpload(Readable.from([Buffer.from('wrong')]), 'application/pdf', 5),
    /PDF file signature/
  )
  await assert.rejects(
    () => service.readNoteUpload(Readable.from([pdf]), 'application/pdf', 0),
    /size is invalid/
  )
})
