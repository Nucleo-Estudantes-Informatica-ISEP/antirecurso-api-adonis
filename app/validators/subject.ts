import vine from '@vinejs/vine'

/**
 * Validator for toggling scoreboard visibility.
 */
export const scoreboardVisibilityValidator = vine.compile(
  vine.object({
    visibility: vine.boolean(),
  })
)
