import vine from '@vinejs/vine'
import { EXAM_MODES, MAX_CUSTOM_QUESTIONS, MIN_CUSTOM_QUESTIONS } from '#services/exams/exam_config'

export const generateExamValidator = vine.compile(
  vine.object({
    mode: vine.enum(EXAM_MODES).optional(),
    user_id: vine.number().withoutDecimals().positive().optional(),
    n_of_questions: vine
      .number()
      .withoutDecimals()
      .min(MIN_CUSTOM_QUESTIONS)
      .max(MAX_CUSTOM_QUESTIONS)
      .optional(),
    filter: vine.string().trim().optional(),
  })
)

export const verifyExamValidator = vine.compile(
  vine.object({
    subject_id: vine.number().withoutDecimals().positive(),
    mode: vine.enum(EXAM_MODES).optional(),
    user_id: vine.number().withoutDecimals().positive().optional(),
    time: vine.number().withoutDecimals().positive().optional(),
    n_of_questions: vine
      .number()
      .withoutDecimals()
      .min(MIN_CUSTOM_QUESTIONS)
      .max(MAX_CUSTOM_QUESTIONS)
      .optional(),
    penalizing_factor: vine.number().min(0).optional(),
    answers: vine
      .array(
        vine.object({
          question_id: vine.number().withoutDecimals().positive(),
          selected_option: vine.string().trim().nullable().optional(),
        })
      )
      .minLength(1),
  })
)

export const examHistoryValidator = vine.compile(
  vine.object({
    user_id: vine.number().withoutDecimals().positive(),
    page: vine.number().withoutDecimals().positive().optional(),
  })
)

export const examAdminStatsValidator = vine.compile(
  vine.object({
    user_id: vine.number().withoutDecimals().positive(),
  })
)
