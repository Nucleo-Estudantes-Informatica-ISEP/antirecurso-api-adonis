import vine from '@vinejs/vine'

/**
 * Validator for requesting a signed upload URL.
 */
export const uploadValidator = vine.compile(
  vine.object({
    contentType: vine.string(),
    target: vine.string(),
  })
)
