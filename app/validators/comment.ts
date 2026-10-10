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

export const commentReportValidator = vine.compile(
  vine.object({
    id: vine.number().positive().withoutDecimals(),
    reason: vine.string().trim().minLength(1).maxLength(2000),
  })
)
export const commentReviewValidator = vine.compile(
  vine.object({
    id: vine.number().positive().withoutDecimals(),
    action: vine.enum(['dismiss', 'remove']),
  })
)
export const safetyIdValidator = vine.compile(
  vine.object({ id: vine.number().positive().withoutDecimals() })
)
