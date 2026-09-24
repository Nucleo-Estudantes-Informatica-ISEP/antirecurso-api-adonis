import env from '#start/env'
import { validateUploadedPdf, NOTE_UPLOAD_POLICY } from '#services/uploads/upload_policy'
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import type { Readable } from 'node:stream'

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Storage service not configured. Set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET.'
    )
  }
}

export class StorageObjectNotFoundError extends Error {
  constructor(path: string) {
    super(`Storage object not found: ${path}`)
  }
}

export class StorageRequestError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
  }
}

export default class StorageService {
  private readonly bucket = env.get('S3_BUCKET')
  private readonly client = this.isConfigured()
    ? new S3Client({
        endpoint: env.get('S3_ENDPOINT'),
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: {
          accessKeyId: env.get('S3_ACCESS_KEY')!,
          secretAccessKey: env.get('S3_SECRET_KEY')!,
        },
      })
    : null

  isConfigured() {
    return Boolean(
      env.get('S3_ENDPOINT') && env.get('S3_ACCESS_KEY') && env.get('S3_SECRET_KEY') && this.bucket
    )
  }

  buildUploadedPath(target: string, id: string) {
    return `uploaded/${target}/${id}`
  }
  buildDistributionPath(target: string, id: string) {
    return `distribution/${target}/${id}`
  }

  async uploadNote(
    id: string,
    stream: Readable,
    contentType: string | null,
    contentLength: number | null
  ) {
    this.assertConfigured()
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength! < 5 ||
      contentLength! > NOTE_UPLOAD_POLICY.maxSize
    ) {
      throw new StorageRequestError('Uploaded PDF size is invalid', 400)
    }
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > NOTE_UPLOAD_POLICY.maxSize)
        throw new StorageRequestError('Uploaded PDF is too large', 413)
      chunks.push(bytes)
    }
    if (size !== contentLength)
      throw new StorageRequestError('Uploaded PDF length does not match', 400)
    const body = Buffer.concat(chunks)
    validateUploadedPdf({ contentType, contentLength: size, prefix: body.subarray(0, 5) })
    const key = this.buildUploadedPath('notes', id)
    if (await this.exists(key)) throw new StorageRequestError('Upload already exists', 409)
    await this.client!.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/pdf',
        IfNoneMatch: '*',
      })
    )
  }

  async promoteUploadedNote(uploadId: string) {
    this.assertConfigured()
    const source = this.buildUploadedPath('notes', uploadId)
    const target = this.buildDistributionPath('notes', uploadId)
    const head = await this.head(source)
    const prefix = await this.client!.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: source, Range: 'bytes=0-4' })
    )
    validateUploadedPdf({
      contentType: head.ContentType ?? null,
      contentLength: head.ContentLength ?? null,
      prefix: new Uint8Array(await prefix.Body!.transformToByteArray()),
    })
    await this.client!.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: target,
        CopySource: `${this.bucket}/${source}`,
      })
    )
    await this.client!.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: source }))
  }

  async downloadNote(path: string) {
    this.assertConfigured()
    try {
      return await this.client!.send(new GetObjectCommand({ Bucket: this.bucket, Key: path }))
    } catch (error) {
      this.rethrowMissing(error, path)
      throw error
    }
  }

  async deleteNoteAssets(uploadId: string) {
    this.assertConfigured()
    for (const Key of [
      this.buildUploadedPath('notes', uploadId),
      this.buildDistributionPath('notes', uploadId),
    ]) {
      await this.client!.send(new DeleteObjectCommand({ Bucket: this.bucket, Key }))
    }
  }

  async exists(path: string) {
    this.assertConfigured()
    try {
      await this.head(path)
      return true
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) return false
      throw error
    }
  }

  private async head(path: string) {
    try {
      return await this.client!.send(new HeadObjectCommand({ Bucket: this.bucket, Key: path }))
    } catch (error) {
      this.rethrowMissing(error, path)
      throw error
    }
  }

  private rethrowMissing(error: unknown, path: string) {
    if (
      error &&
      typeof error === 'object' &&
      '$metadata' in error &&
      (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 404
    ) {
      throw new StorageObjectNotFoundError(path)
    }
  }

  private assertConfigured() {
    if (!this.client || !this.bucket) throw new StorageNotConfiguredError()
  }
}
