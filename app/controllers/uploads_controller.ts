import type { HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'
import { uploadValidator } from '#validators/upload'
import StorageService, {
  StorageNotConfiguredError,
  StorageRequestError,
} from '#services/storage_service'

/**
 * Upload target configuration.
 * Matches the Laravel UploadController::config.
 */
const UPLOAD_TARGETS: Record<string, { types: string[]; maxSize: number }> = {
  notes: {
    types: ['application/pdf'],
    maxSize: 64 * 1024 * 1024, // 64 MB
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

    const storageService = new StorageService()
    const uuid = randomUUID()
    const maxSize = targetCfg.maxSize
    const expires = new Date(Date.now() + 5 * 60 * 1000)

    try {
      const path = storageService.buildUploadedPath(data.target, uuid)
      const signed = await storageService.createSignedUploadUrl(path)

      return response.ok({
        id: uuid,
        contentType: data.contentType,
        target: data.target,
        maxSize,
        expires: expires.toISOString(),
        url: signed.signedUrl,
        headers: {
          'x-upsert': 'false',
        },
        uploadMode: 'supabase-signed-put',
      })
    } catch (error) {
      if (error instanceof StorageNotConfiguredError) {
        return response.serviceUnavailable({ message: error.message })
      }

      if (error instanceof StorageRequestError) {
        return response.internalServerError({ message: error.message, status: error.status })
      }

      throw error
    }
  }
}
