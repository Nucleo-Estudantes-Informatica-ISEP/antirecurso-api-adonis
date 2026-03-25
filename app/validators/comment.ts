import vine from '@vinejs/vine'

/**
 * Validator for creating a comment.
 */
export const createCommentValidator = vine.compile(
  vine.object({
    comment: vine.string().minLength(1).maxLength(2000),
    question_id: vine.number(),
  })
)
