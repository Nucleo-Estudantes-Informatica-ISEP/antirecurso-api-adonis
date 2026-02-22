import vine from '@vinejs/vine'

/**
 * Validator for searching users (admin).
 */
export const searchUsersValidator = vine.compile(
  vine.object({
    query: vine.string().minLength(1),
  })
)
