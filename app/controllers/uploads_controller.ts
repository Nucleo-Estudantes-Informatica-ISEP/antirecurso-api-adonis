import type { HttpContext } from '@adonisjs/core/http'
import { uploadValidator } from '#validators/upload'

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
    // TODO: add auth middleware when auth service is integrated

    const data = await request.validateUsing(uploadValidator)

    const targetCfg = UPLOAD_TARGETS[data.target]
    if (!targetCfg) {
      return response.badRequest({ message: 'Invalid target' })
    }

    if (!targetCfg.types.includes(data.contentType)) {
      return response.badRequest({ message: 'Invalid file type' })
    }

    // TODO: integrate storage service (Firebase or Supabase) to generate
    // a signed PUT URL for the file upload.
    //
    // import { randomUUID } from 'node:crypto'
    // const uuid = randomUUID()
    // const filename = `uploaded/${data.target}/${uuid}`
    // const maxSize = targetCfg.maxSize
    // const headers = { 'X-Goog-Content-Length-Range': `1,${maxSize}` }
    // const expires = new Date(Date.now() + 5 * 60 * 1000) // 5 min
    // const url = await bucket.file(filename).getSignedUrl({
    //   action: 'write',
    //   expires,
    //   contentType: data.contentType,
    //   extensionHeaders: headers,
    //   version: 'v4',
    // })

    return response.serviceUnavailable({
      message: 'Storage service not yet configured. Please configure Firebase or Supabase.',
      // Once storage is configured, this should return:
      // id: uuid,
      // contentType: data.contentType,
      // target: data.target,
      // maxSize,
      // expires,
      // url,
      // headers,
    })
  }
}
