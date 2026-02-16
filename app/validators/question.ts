import vine from '@vinejs/vine'

/**
 * Validator for updating a question.
 */
export const updateQuestionValidator = vine.compile(
    vine.object({
        correct_option: vine.string().minLength(1),
        question: vine.string(),
        options: vine.array(
            vine.object({
                id: vine.number(),
                name: vine.string(),
            })
        ),
    })
)
