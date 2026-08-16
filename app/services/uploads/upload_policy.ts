export const NOTE_UPLOAD_POLICY = {
  contentTypes: ['application/pdf'],
  maxSize: 64 * 1024 * 1024,
} as const

export class InvalidUploadedObjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidUploadedObjectError'
  }
}

export function validateUploadedPdf(input: {
  contentType: string | null
  contentLength: number | null
  prefix: Uint8Array
}) {
  const normalizedContentType = input.contentType?.split(';')[0].trim().toLowerCase() ?? null
  if (normalizedContentType !== NOTE_UPLOAD_POLICY.contentTypes[0]) {
    throw new InvalidUploadedObjectError('Uploaded note must have the application/pdf type')
  }

  if (
    input.contentLength === null ||
    !Number.isSafeInteger(input.contentLength) ||
    input.contentLength < 5 ||
    input.contentLength > NOTE_UPLOAD_POLICY.maxSize
  ) {
    throw new InvalidUploadedObjectError(
      'Uploaded note size is missing or outside the allowed range'
    )
  }

  if (new TextDecoder('ascii').decode(input.prefix.slice(0, 5)) !== '%PDF-') {
    throw new InvalidUploadedObjectError('Uploaded note does not contain a PDF file signature')
  }
}
