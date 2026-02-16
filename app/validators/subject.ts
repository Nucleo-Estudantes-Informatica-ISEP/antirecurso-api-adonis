import vine from '@vinejs/vine'

/**
 * Validator for toggling scoreboard visibility.
 */
export const scoreboardVisibilityValidator = vine.compile(
  vine.object({
    visibility: vine.boolean(),
  })
)

/**
 * Temporary validator for user_id until auth middleware is integrated.
 * TODO: Remove when auth service is in place.
 */
export const tempAuthValidator = vine.compile(
  vine.object({
    user_id: vine.number().positive().withoutDecimals(),
  })
)
