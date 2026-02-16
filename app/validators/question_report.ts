import vine from '@vinejs/vine'

/**
 * Validator for creating a question report.
 */
export const createQuestionReportValidator = vine.compile(
    vine.object({
        reason: vine.string().minLength(1).optional(),
        question_id: vine.number(),
        user_id: vine.number(), // TODO: remove when auth service is integrated — use auth user instead
    })
)

/**
 * Validator for the bulk review action (admin).
 */
export const reviewQuestionReportsValidator = vine.compile(
    vine.object({
        question_ids: vine.array(vine.number()),
        user_id: vine.number(), // TODO: remove when auth service is integrated — use auth user instead
    })
)
