import vine from '@vinejs/vine'

/**
 * Validator for creating a question report.
 */
export const createQuestionReportValidator = vine.compile(
  vine.object({
    reason: vine.string().trim().minLength(1).optional(),
    question_id: vine.number(),
  })
)

/**
 * Validator for listing question reports with filters/sorting.
 */
export const listQuestionReportsValidator = vine.compile(
  vine.object({
    solved: vine.enum(['true', 'false'] as const).optional(),
    sort: vine
      .enum([
        'id',
        'question_id',
        'created_at',
        'reason',
        'user_id',
        'reviewed_at',
        'solved',
        'reviewed_by',
      ] as const)
      .optional(),
    order: vine.enum(['asc', 'desc'] as const).optional(),
  })
)

/**
 * Validator for marking question reports as solved.
 */
export const reviewQuestionReportsValidator = vine.compile(
  vine.object({
    question_ids: vine.array(vine.number()).minLength(1),
  })
)
