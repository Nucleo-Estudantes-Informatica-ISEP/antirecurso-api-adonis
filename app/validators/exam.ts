import vine from '@vinejs/vine'
import { EXAM_MODES, MAX_CUSTOM_QUESTIONS, MIN_CUSTOM_QUESTIONS } from '#services/exams/exam_config'

export const generateExamValidator = vine.compile(
  vine.object({
    attempt_id: vine.string().uuid().optional(),
    mode: vine.enum(EXAM_MODES).optional(),
    n_of_questions: vine
      .number()
      .withoutDecimals()
      .min(MIN_CUSTOM_QUESTIONS)
      .max(MAX_CUSTOM_QUESTIONS)
      .optional(),
    penalizing_factor: vine.number().min(0).max(1).optional(),
    filter: vine.string().trim().optional(),
  })
)

export const verifyExamValidator = vine.compile(
  vine.object({
    subject_id: vine.number().withoutDecimals().positive(),
    attempt_id: vine.string().uuid().optional(),
    mode: vine.enum(EXAM_MODES).optional(),
    time: vine.number().withoutDecimals().positive().optional(),
    n_of_questions: vine
      .number()
      .withoutDecimals()
      .min(MIN_CUSTOM_QUESTIONS)
      .max(MAX_CUSTOM_QUESTIONS)
      .optional(),
    penalizing_factor: vine.number().min(0).max(1).optional(),
    answers: vine
      .array(
        vine.object({
          question_id: vine.number().withoutDecimals().positive(),
          selected_option: vine
            .string()
            .trim()
            .regex(/^[A-Za-z0-9]$/)
            .optional(),
        })
      )
      .minLength(1),
  })
)

export const examHistoryValidator = vine.compile(
  vine.object({
    page: vine.number().withoutDecimals().positive().optional(),
  })
)

export const examStateIdentifierValidator = vine.compile(
  vine.object({
    subject_id: vine.number().withoutDecimals().positive(),
    mode: vine.enum(EXAM_MODES),
  })
)

export const saveExamStateValidator = vine.compile(
  vine.object({
    subject_id: vine.number().withoutDecimals().positive(),
    mode: vine.enum(EXAM_MODES),
    attempt_id: vine.string().uuid().optional(),
    expected_revision: vine.number().withoutDecimals().min(0).optional(),
    expected_state_id: vine.number().withoutDecimals().positive().optional(),
    restart_completed: vine.boolean().optional(),
    state: vine.any(),
  })
)
