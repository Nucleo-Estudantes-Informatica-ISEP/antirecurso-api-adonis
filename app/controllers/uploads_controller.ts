import type { HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'
import { uploadValidator } from '#validators/upload'
import StorageService, {
  StorageNotConfiguredError,
  StorageRequestError,
} from '#services/storage_service'
import { InvalidUploadedObjectError, NOTE_UPLOAD_POLICY } from '#services/uploads/upload_policy'
import { signUploadAccess, verifyUploadAccess } from '#services/uploads/signed_note_access'
import env from '#start/env'

/**
 * Upload target configuration.
 * Matches the Laravel UploadController::config.
 */
const UPLOAD_TARGETS: Record<string, { types: string[]; maxSize: number }> = {
  notes: {
    types: [...NOTE_UPLOAD_POLICY.contentTypes],
    maxSize: NOTE_UPLOAD_POLICY.maxSize,
  },
}

export default class UploadsController {
  /**
   * Generate a signed upload URL for a target storage path.
   * POST /upload
   */
  async upload({ request, response }: HttpContext) {
    const data = await request.validateUsing(uploadValidator)

    const targetCfg = UPLOAD_TARGETS[data.target]
    if (!targetCfg) {
      return response.badRequest({ message: 'Invalid target' })
    }

    if (!targetCfg.types.includes(data.contentType)) {
      return response.badRequest({ message: 'Invalid file type' })
    }
    if (!new StorageService().isConfigured()) {
      return response.serviceUnavailable({ message: new StorageNotConfiguredError().message })
    }

    const uuid = randomUUID()
    const maxSize = targetCfg.maxSize
    const expires = Date.now() + 5 * 60 * 1000
    const signature = signUploadAccess(env.get('APP_KEY'), uuid, expires)

    return response.ok({
      id: uuid,
      contentType: data.contentType,
      target: data.target,
      maxSize,
      expires: new Date(expires).toISOString(),
      url: `/api/protected/uploads/${uuid}?expires=${expires}&signature=${signature}`,
      headers: { 'content-type': data.contentType },
      uploadMode: 'raw-put',
    })
  }

  async put({ params, request, response }: HttpContext) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
      return response.badRequest({ message: 'Invalid upload id' })
    }
    if (
      !verifyUploadAccess(
        env.get('APP_KEY'),
        params.id,
        Number(request.input('expires')),
        String(request.input('signature', ''))
      )
    ) {
      return response.forbidden({ message: 'Upload access expired' })
    }
    try {
      await new StorageService().uploadNote(
        params.id,
        request.request,
        request.header('content-type') ?? null,
        Number(request.header('content-length')) || null
      )
      return response.noContent()
    } catch (error) {
      if (error instanceof StorageRequestError)
        return response.status(error.status).send({ message: error.message })
      if (error instanceof InvalidUploadedObjectError)
        return response.badRequest({ message: error.message })
      if (error instanceof StorageNotConfiguredError)
        return response.serviceUnavailable({ message: error.message })
      throw error
    }
  }
}
