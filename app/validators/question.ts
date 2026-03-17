import vine from '@vinejs/vine'

/**
 * Validator for updating a question.
 */
export const updateQuestionValidator = vine.compile(
  vine.object({
    correct_option: vine.string().minLength(1),
    question: vine.string().minLength(1),
    options: vine
      .array(
        vine.object({
          id: vine.number(),
          name: vine.string().minLength(1),
        })
      )
      .minLength(2),
  })
)
