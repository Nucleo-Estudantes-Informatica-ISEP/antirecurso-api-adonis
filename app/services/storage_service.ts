import env from '#start/env'
import { validateUploadedPdf } from '#services/uploads/upload_policy'

type JsonValue = Record<string, any> | string | null

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Storage service not configured. Please set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET.'
    )
    this.name = 'StorageNotConfiguredError'
  }
}

export class StorageObjectNotFoundError extends Error {
  constructor(path: string) {
    super(`Storage object not found: ${path}`)
    this.name = 'StorageObjectNotFoundError'
  }
}

export class StorageRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: JsonValue
  ) {
    super(message)
    this.name = 'StorageRequestError'
  }
}

function normalizePath(path: string) {
  return path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null
}

function buildErrorMessage(payload: JsonValue, fallback: string) {
  if (typeof payload === 'string' && payload.trim()) {
    return payload
  }

  if (isRecord(payload)) {
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message
    }
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error
    }
    if (typeof payload.msg === 'string' && payload.msg.trim()) {
      return payload.msg
    }
  }

  return fallback
}

export type SignedUpload = {
  signedUrl: string
  token: string
}

export default class StorageService {
  private readonly supabaseUrl = env.get('SUPABASE_URL')?.replace(/\/+$/g, '')
  private readonly serviceRoleKey = env.get('SUPABASE_SERVICE_ROLE_KEY')
  private readonly bucket = env.get('SUPABASE_STORAGE_BUCKET')

  isConfigured() {
    return Boolean(this.supabaseUrl && this.serviceRoleKey && this.bucket)
  }

  buildUploadedPath(target: string, id: string) {
    return normalizePath(`uploaded/${target}/${id}`)
  }

  buildDistributionPath(target: string, id: string) {
    return normalizePath(`distribution/${target}/${id}`)
  }

  async createSignedUploadUrl(path: string): Promise<SignedUpload> {
    this.assertConfigured()

    const payload = await this.requestJson('POST', this.objectUploadSignUrl(path), {
      body: {},
      headers: { 'x-upsert': 'false' },
    })

    if (!isRecord(payload) || typeof payload.url !== 'string') {
      throw new StorageRequestError(
        'Supabase storage did not return a signed upload URL.',
        500,
        payload
      )
    }

    const signedUrl = this.buildAbsoluteStorageUrl(payload.url)
    const token = new URL(signedUrl).searchParams.get('token')

    if (!token) {
      throw new StorageRequestError(
        'Supabase storage did not return an upload token.',
        500,
        payload
      )
    }

    return { signedUrl, token }
  }

  async promoteUploadedNote(uploadId: string) {
    const uploadedPath = this.buildUploadedPath('notes', uploadId)
    const distributionPath = this.buildDistributionPath('notes', uploadId)

    await this.validateUploadedNote(uploadedPath)

    await this.requestJson('POST', `${this.storageApiBase()}/object/move`, {
      body: {
        bucketId: this.bucket,
        sourceKey: uploadedPath,
        destinationKey: distributionPath,
      },
    })
  }

  private async validateUploadedNote(path: string) {
    this.assertConfigured()

    const metadataResponse = await fetch(this.objectUrl(path), {
      method: 'HEAD',
      headers: this.authHeaders(),
    })
    if (metadataResponse.status === 400 || metadataResponse.status === 404) {
      throw new StorageObjectNotFoundError(path)
    }
    if (!metadataResponse.ok) {
      throw new StorageRequestError(
        `Supabase storage metadata request failed with status ${metadataResponse.status}.`,
        metadataResponse.status
      )
    }

    const prefixResponse = await fetch(this.objectUrl(path), {
      headers: this.authHeaders({ Range: 'bytes=0-4' }),
    })
    if (!prefixResponse.ok || prefixResponse.status !== 206) {
      throw new StorageRequestError(
        `Supabase storage content validation failed with status ${prefixResponse.status}.`,
        prefixResponse.status
      )
    }

    const contentLengthHeader = metadataResponse.headers.get('content-length')
    const parsedContentLength = contentLengthHeader ? Number(contentLengthHeader) : null
    validateUploadedPdf({
      contentType: metadataResponse.headers.get('content-type'),
      contentLength:
        parsedContentLength !== null && Number.isFinite(parsedContentLength)
          ? parsedContentLength
          : null,
      prefix: new Uint8Array(await prefixResponse.arrayBuffer()),
    })
  }

  async createSignedDownloadUrl(path: string, expiresInSeconds = 300) {
    this.assertConfigured()

    const payload = await this.requestJson('POST', this.objectSignUrl(path), {
      body: { expiresIn: expiresInSeconds },
    })

    if (!isRecord(payload) || typeof payload.signedURL !== 'string') {
      throw new StorageRequestError(
        'Supabase storage did not return a signed download URL.',
        500,
        payload
      )
    }

    return this.buildAbsoluteStorageUrl(payload.signedURL)
  }

  async deleteNoteAssets(uploadId: string) {
    this.assertConfigured()

    const paths = [
      this.buildUploadedPath('notes', uploadId),
      this.buildDistributionPath('notes', uploadId),
    ]

    const resolvedPaths = await Promise.all(
      paths.map(async (path) => ((await this.exists(path)) ? path : null))
    )
    const existingPaths = resolvedPaths.filter((path): path is string => path !== null)

    if (!existingPaths.length) {
      return
    }

    await this.requestJson('DELETE', `${this.storageApiBase()}/object/${this.bucket}`, {
      body: {
        prefixes: existingPaths,
      },
    })
  }

  async exists(path: string) {
    this.assertConfigured()

    const response = await fetch(this.objectUrl(path), {
      method: 'HEAD',
      headers: this.authHeaders(),
    })

    if (response.ok) {
      return true
    }

    if (response.status === 400 || response.status === 404) {
      return false
    }

    const payload = await this.parsePayload(response)
    throw new StorageRequestError(
      buildErrorMessage(
        payload,
        `Supabase storage HEAD request failed with status ${response.status}.`
      ),
      response.status,
      payload
    )
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new StorageNotConfiguredError()
    }
  }

  private storageApiBase() {
    this.assertConfigured()
    return `${this.supabaseUrl}/storage/v1`
  }

  private objectUrl(path: string) {
    return `${this.storageApiBase()}/object/${this.bucketPath(path)}`
  }

  private objectUploadSignUrl(path: string) {
    return `${this.storageApiBase()}/object/upload/sign/${this.bucketPath(path)}`
  }

  private objectSignUrl(path: string) {
    return `${this.storageApiBase()}/object/sign/${this.bucketPath(path)}`
  }

  private bucketPath(path: string) {
    this.assertConfigured()
    return `${this.bucket}/${normalizePath(path)}`
  }

  private authHeaders(extraHeaders: Record<string, string> = {}) {
    this.assertConfigured()

    return {
      apikey: this.serviceRoleKey!,
      Authorization: `Bearer ${this.serviceRoleKey!}`,
      ...extraHeaders,
    }
  }

  private async requestJson(
    method: 'POST' | 'PUT' | 'DELETE',
    url: string,
    options: { body?: Record<string, any>; headers?: Record<string, string> } = {}
  ) {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(options.headers),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    const payload = await this.parsePayload(response)
    if (!response.ok) {
      throw new StorageRequestError(
        buildErrorMessage(
          payload,
          `Supabase storage request failed with status ${response.status}.`
        ),
        response.status,
        payload
      )
    }

    return payload
  }

  private async parsePayload(response: Response): Promise<JsonValue> {
    const text = await response.text()

    if (!text) {
      return null
    }

    try {
      return JSON.parse(text) as Record<string, any>
    } catch {
      return text
    }
  }

  private buildAbsoluteStorageUrl(value: string) {
    if (/^https?:\/\//i.test(value)) {
      return value
    }

    return `${this.storageApiBase()}${value}`
  }
}
