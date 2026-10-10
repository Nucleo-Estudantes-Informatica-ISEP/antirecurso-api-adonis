import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { GeneratedQuestion } from '#services/exams/exam_generation_service'
import type { VerifyExamResult } from '#services/exams/exam_verification_service'

export type AttemptQuestion = Omit<GeneratedQuestion, 'options'> & {
  correctOption: string
  options: { id: number; name: string; order: string }[]
}
export default class ExamAttempt extends BaseModel {
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare userId: number | null
  @column()
  declare subjectId: number
  @column()
  declare mode: string
  @column({
    prepare: (value) => JSON.stringify(value),
    consume: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare snapshot: {
    questions: AttemptQuestion[]
    nOfQuestions: number | null
    penalizingFactor: number | null
  }
  @column()
  declare requestHash: string | null
  @column({
    prepare: (value) => (value ? JSON.stringify(value) : null),
    consume: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare result: VerifyExamResult | null
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
