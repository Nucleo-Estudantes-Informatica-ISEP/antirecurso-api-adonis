import vine from '@vinejs/vine'
import { QUESTION_SOURCES } from '#services/questions/question_source'

/**
 * Validator for updating a question.
 */
export const updateQuestionValidator = vine.compile(
  vine.object({
    correct_option: vine.string().minLength(1),
    question: vine.string().minLength(1),
    source: vine.enum(QUESTION_SOURCES).optional(),
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
