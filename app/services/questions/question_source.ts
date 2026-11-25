export const QUESTION_SOURCES = ['REAL_EXAM', 'AI_GENERATED', 'MANUAL'] as const

export type QuestionSource = (typeof QUESTION_SOURCES)[number]
