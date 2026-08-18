import { test } from '@japa/runner'
import {
  InvalidUploadedObjectError,
  NOTE_UPLOAD_POLICY,
  validateUploadedPdf,
} from '#services/uploads/upload_policy'

const pdfPrefix = new TextEncoder().encode('%PDF-')

test.group('Upload policy', () => {
  test('accepts a bounded stored PDF object', ({ assert }) => {
    assert.doesNotThrow(() =>
      validateUploadedPdf({
        contentType: 'application/pdf; charset=binary',
        contentLength: 1024,
        prefix: pdfPrefix,
      })
    )
  })

  test('rejects forged types, oversized objects, and non-PDF bytes', ({ assert }) => {
    const invalidObjects = [
      { contentType: 'text/html', contentLength: 1024, prefix: pdfPrefix },
      {
        contentType: 'application/pdf',
        contentLength: NOTE_UPLOAD_POLICY.maxSize + 1,
        prefix: pdfPrefix,
      },
      {
        contentType: 'application/pdf',
        contentLength: 1024,
        prefix: new TextEncoder().encode('<html'),
      },
    ]

    for (const object of invalidObjects) {
      assert.throws(() => validateUploadedPdf(object), InvalidUploadedObjectError)
    }
  })
})
