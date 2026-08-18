import { EXAM_MODES, MAX_CUSTOM_QUESTIONS, MIN_CUSTOM_QUESTIONS } from './exam_config.js'
import type { ExamMode } from './exam_config.js'

const MAX_EXAM_DURATION_SECONDS = 8 * 60 * 60
const MAX_FILTER_LENGTH = 100

export type SavedExamState = {
  version: 2
  subjectId: number
  mode: ExamMode
  questionIds: number[]
  answers: [number, string][]
  time: number
  currentQuestionIndex: number
  n_of_questions?: number
  penalizing_factor?: number
  filter?: string
  totalQuestions: number
  answered: number
}

export class InvalidExamStateError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

export function normalizeSavedExamState(
  input: unknown,
  expectedSubjectId: number,
  expectedMode: ExamMode
): SavedExamState {
  if (!isRecord(input) || input.version !== 2) {
    throw new InvalidExamStateError('Unsupported exam state version')
  }

  if (input.subjectId !== expectedSubjectId || input.mode !== expectedMode) {
    throw new InvalidExamStateError('Exam state identity does not match the request')
  }

  if (!EXAM_MODES.includes(input.mode as ExamMode)) {
    throw new InvalidExamStateError('Invalid exam mode')
  }

  if (!Array.isArray(input.questionIds) || input.questionIds.length === 0) {
    throw new InvalidExamStateError('Exam state must contain questions')
  }

  if (input.questionIds.length > MAX_CUSTOM_QUESTIONS) {
    throw new InvalidExamStateError('Exam state has too many questions')
  }

  const questionIds = input.questionIds.map((questionId) => {
    if (!isIntegerInRange(questionId, 1, Number.MAX_SAFE_INTEGER)) {
      throw new InvalidExamStateError('Invalid question id')
    }
    return questionId
  })

  if (new Set(questionIds).size !== questionIds.length) {
    throw new InvalidExamStateError('Exam state contains duplicate questions')
  }

  if (!Array.isArray(input.answers) || input.answers.length > questionIds.length) {
    throw new InvalidExamStateError('Invalid saved answers')
  }

  const questionIdSet = new Set(questionIds)
  const answeredQuestionIds = new Set<number>()
  const answers = input.answers.map((answer) => {
    if (!Array.isArray(answer) || answer.length !== 2) {
      throw new InvalidExamStateError('Invalid saved answer')
    }

    const [questionId, selectedOption] = answer
    if (
      !isIntegerInRange(questionId, 1, Number.MAX_SAFE_INTEGER) ||
      !questionIdSet.has(questionId) ||
      answeredQuestionIds.has(questionId) ||
      typeof selectedOption !== 'string' ||
      !/^[A-Za-z0-9]$/.test(selectedOption)
    ) {
      throw new InvalidExamStateError('Invalid saved answer')
    }

    answeredQuestionIds.add(questionId)
    return [questionId, selectedOption.toUpperCase()] as [number, string]
  })

  if (!isIntegerInRange(input.time, 0, MAX_EXAM_DURATION_SECONDS)) {
    throw new InvalidExamStateError('Invalid exam duration')
  }

  if (!isIntegerInRange(input.currentQuestionIndex, 0, questionIds.length - 1)) {
    throw new InvalidExamStateError('Invalid current question index')
  }

  const nOfQuestions = input.n_of_questions
  if (
    nOfQuestions !== undefined &&
    !isIntegerInRange(nOfQuestions, MIN_CUSTOM_QUESTIONS, MAX_CUSTOM_QUESTIONS)
  ) {
    throw new InvalidExamStateError('Invalid custom question count')
  }
  if (expectedMode === 'custom' && nOfQuestions === undefined) {
    throw new InvalidExamStateError('Custom exam state requires a question count')
  }

  const penalizingFactor = input.penalizing_factor
  if (
    penalizingFactor !== undefined &&
    (typeof penalizingFactor !== 'number' ||
      !Number.isFinite(penalizingFactor) ||
      penalizingFactor < 0 ||
      penalizingFactor > 1)
  ) {
    throw new InvalidExamStateError('Invalid penalizing factor')
  }
  if (expectedMode === 'custom' && penalizingFactor === undefined) {
    throw new InvalidExamStateError('Custom exam state requires a penalizing factor')
  }

  const filter = input.filter
  if (filter !== undefined && (typeof filter !== 'string' || filter.length > MAX_FILTER_LENGTH)) {
    throw new InvalidExamStateError('Invalid exam filter')
  }

  return {
    version: 2,
    subjectId: expectedSubjectId,
    mode: expectedMode,
    questionIds,
    answers,
    time: input.time,
    currentQuestionIndex: input.currentQuestionIndex,
    ...(nOfQuestions === undefined ? {} : { n_of_questions: nOfQuestions }),
    ...(penalizingFactor === undefined ? {} : { penalizing_factor: penalizingFactor }),
    ...(filter === undefined ? {} : { filter }),
    totalQuestions: questionIds.length,
    answered: answers.length,
  }
}
