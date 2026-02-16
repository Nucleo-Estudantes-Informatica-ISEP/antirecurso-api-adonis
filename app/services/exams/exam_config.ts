export const MAX_SCORE = 100
export const EXAM_HISTORY_PAGE_SIZE = 10
export const MIN_CUSTOM_QUESTIONS = 5
export const MAX_CUSTOM_QUESTIONS = 50

export const EXAM_MODES = ['default', 'realistic', 'new', 'wrong', 'hard', 'custom'] as const

export type ExamMode = (typeof EXAM_MODES)[number]

export type SubjectExamRule = {
  n_of_questions: number
  penalizing_factor: number
  minimum_options: number
}

const SUBJECT_RULES_BY_SLUG: Record<string, SubjectExamRule> = {
  rcomp: {
    n_of_questions: 17,
    penalizing_factor: 0,
    minimum_options: 4,
  },
  scomp: {
    n_of_questions: 20,
    penalizing_factor: 1 / 3,
    minimum_options: 2,
  },
  algav: {
    n_of_questions: 5,
    penalizing_factor: 1 / 4,
    minimum_options: 5,
  },
  asist: {
    n_of_questions: 50,
    penalizing_factor: 1 / 2,
    minimum_options: 2,
  },
  sgrai: {
    n_of_questions: 10,
    penalizing_factor: 1 / 3,
    minimum_options: 2,
  },
  prcmp: {
    n_of_questions: 17,
    penalizing_factor: 0,
    minimum_options: 2,
  },
  arqcp: {
    n_of_questions: 20,
    penalizing_factor: 1 / 2,
    minimum_options: 2,
  },
  default: {
    n_of_questions: 10,
    penalizing_factor: 0,
    minimum_options: 2,
  },
}

export const DEFAULT_EXAM_RULE = SUBJECT_RULES_BY_SLUG.default

export function getSubjectExamRule(slug: string): SubjectExamRule {
  return SUBJECT_RULES_BY_SLUG[slug] ?? DEFAULT_EXAM_RULE
}

export function modeRequiresUser(mode: ExamMode): boolean {
  return (
    mode === 'realistic' ||
    mode === 'new' ||
    mode === 'wrong' ||
    mode === 'hard' ||
    mode === 'custom'
  )
}
