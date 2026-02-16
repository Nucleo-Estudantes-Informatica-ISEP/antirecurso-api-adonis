import vine from '@vinejs/vine'

/**
 * Validator for creating a comment.
 */
export const createCommentValidator = vine.compile(
  vine.object({
    comment: vine.string().minLength(1),
    question_id: vine.number(),
    user_id: vine.number(), // TODO: remove when auth service is integrated — use auth user instead
  })
)
