import db from '@adonisjs/lucid/services/db'
import Answer from '#models/answer'
import AnswerQuestion from '#models/answer_question'
import Option from '#models/option'
import Question from '#models/question'
import Score from '#models/score'
import Subject from '#models/subject'
import {
  DEFAULT_EXAM_RULE,
  type ExamMode,
  MAX_SCORE,
  PASSING_SCORE_TOLERANCE,
  getSubjectExamRule,
} from '#services/exams/exam_config'

export type VerifyExamAnswerInput = {
  question_id: number
  selected_option?: string
}

export type VerifyExamInput = {
  subject: Subject
  mode: ExamMode
  answers: VerifyExamAnswerInput[]
  userId: number | null
  time: number | null
  nOfQuestions: number | null
  penalizingFactor: number | null
}

export type VerifyExamResult = {
  id: number
  score: number
  wrong_answers: number
  passed: boolean
  subject: string
}

type TransactionClient = Awaited<ReturnType<typeof db.transaction>>

export default class ExamVerificationService {
  async verify(input: VerifyExamInput): Promise<VerifyExamResult> {
    const nOfQuestions = this.resolveQuestionCount(
      input.mode,
      input.subject.slug,
      input.nOfQuestions
    )
    this.validateExpectedAnswerCount(input.answers, nOfQuestions)
    this.validateUniqueQuestionAnswers(input.answers)

    const questionMap = await this.getQuestionMap(input.answers, input.subject.id)

    const questionScore = MAX_SCORE / nOfQuestions

    let correctAnswers = 0
    let nOfNotAnswered = 0

    const trx = await db.transaction()
    try {
      const userAnswer = await Answer.create(
        {
          score: 0,
          userId: input.userId,
          mode: input.mode,
          time: input.time,
          subjectId: input.subject.id,
        },
        { client: trx }
      )

      const questionIds = [...questionMap.keys()]
      const optionMap = await this.getOptionMap(questionIds, trx)

      for (const answerPayload of input.answers) {
        const question = questionMap.get(answerPayload.question_id)
        if (!question) {
          continue
        }

        const selectedOption = this.normalizeOptionValue(answerPayload.selected_option)
        const correctOption = this.getValidatedCorrectOption(question)

        let optionId: number | null = null
        if (selectedOption !== null) {
          const resolvedOptionId = optionMap.get(this.toOptionMapKey(question.id, selectedOption))
          if (resolvedOptionId === undefined) {
            throw new Error(
              `Invalid selected_option "${answerPayload.selected_option}" for question ${question.id}`
            )
          }
          optionId = resolvedOptionId
        }

        const isWrong = correctOption !== selectedOption
        if (!isWrong) {
          correctAnswers++
        }

        if (selectedOption === null) {
          nOfNotAnswered++
        }

        await AnswerQuestion.create(
          {
            answerId: userAnswer.id,
            questionId: question.id,
            optionId,
            isWrong,
          },
          { client: trx }
        )
      }

      const wrongAnswers = Math.max(0, nOfQuestions - nOfNotAnswered - correctAnswers)
      const rawScore = this.calculateScore({
        mode: input.mode,
        subjectSlug: input.subject.slug,
        correctAnswers,
        wrongAnswers,
        questionScore,
        penalizingFactor: input.penalizingFactor,
      })

      const normalizedScore = Number(Math.max(0, rawScore).toFixed(2))
      const persistedScore = Math.round(normalizedScore)
      const passed = normalizedScore >= MAX_SCORE / 2 - PASSING_SCORE_TOLERANCE

      userAnswer.score = persistedScore
      userAnswer.useTransaction(trx)
      await userAnswer.save()

      if (input.userId !== null) {
        await this.updateScoreboard(input.subject.id, input.userId, persistedScore, trx)
      }

      await trx.commit()

      return {
        id: userAnswer.id,
        score: normalizedScore,
        wrong_answers: wrongAnswers,
        passed,
        subject: input.subject.name,
      }
    } catch (error) {
      await trx.rollback()
      throw error
    }
  }

  private resolveQuestionCount(
    mode: ExamMode,
    subjectSlug: string,
    nOfQuestions: number | null
  ): number {
    if (mode === 'realistic') {
      return getSubjectExamRule(subjectSlug).n_of_questions
    }

    if (mode === 'custom') {
      if (nOfQuestions === null) {
        throw new Error('Custom exams require n_of_questions')
      }

      return nOfQuestions
    }

    return DEFAULT_EXAM_RULE.n_of_questions
  }

  private validateExpectedAnswerCount(
    answers: VerifyExamAnswerInput[],
    expectedQuestionsCount: number
  ): void {
    if (answers.length !== expectedQuestionsCount) {
      throw new Error(
        `Invalid answers payload: expected ${expectedQuestionsCount} answers, received ${answers.length}`
      )
    }
  }

  private validateUniqueQuestionAnswers(answers: VerifyExamAnswerInput[]): void {
    const seenQuestionIds = new Set<number>()
    const duplicateQuestionIds = new Set<number>()

    for (const answer of answers) {
      if (seenQuestionIds.has(answer.question_id)) {
        duplicateQuestionIds.add(answer.question_id)
      } else {
        seenQuestionIds.add(answer.question_id)
      }
    }

    if (duplicateQuestionIds.size > 0) {
      throw new Error(
        `Invalid answers payload: duplicate question IDs [${[...duplicateQuestionIds].join(', ')}]`
      )
    }
  }

  private calculateScore(input: {
    mode: ExamMode
    subjectSlug: string
    correctAnswers: number
    wrongAnswers: number
    questionScore: number
    penalizingFactor: number | null
  }): number {
    let score = input.correctAnswers * input.questionScore

    if (input.mode === 'realistic') {
      const penalizingFactor = getSubjectExamRule(input.subjectSlug).penalizing_factor
      score -= input.wrongAnswers * input.questionScore * penalizingFactor
    } else if (input.mode === 'custom') {
      const penalizingFactor = input.penalizingFactor ?? 0
      score -= input.wrongAnswers * input.questionScore * penalizingFactor
    }

    return score
  }

  private async getQuestionMap(
    answers: VerifyExamAnswerInput[],
    subjectId: number
  ): Promise<Map<number, Question>> {
    const questionIds = [...new Set(answers.map((answer) => answer.question_id))]
    const questions = await Question.query().whereIn('id', questionIds)

    if (questions.length !== questionIds.length) {
      const foundQuestionIds = new Set(questions.map((question) => question.id))
      const missingQuestionIds = questionIds.filter(
        (questionId) => !foundQuestionIds.has(questionId)
      )

      throw new Error(
        `Invalid question list: unknown question IDs [${missingQuestionIds.join(', ')}]`
      )
    }

    const subjectMismatches = questions
      .filter((question) => question.subjectId !== subjectId)
      .map((question) => `${question.id}(subject:${question.subjectId})`)

    if (subjectMismatches.length > 0) {
      throw new Error(
        `Question-subject mismatch: expected subject ${subjectId}, but found questions [${subjectMismatches.join(', ')}]`
      )
    }

    const questionMap = new Map<number, Question>()
    for (const question of questions) {
      questionMap.set(question.id, question)
    }

    return questionMap
  }

  private async getOptionMap(questionIds: number[], trx: TransactionClient) {
    const options = await Option.query({ client: trx }).whereIn('questionId', questionIds)

    const optionMap = new Map<string, number>()
    for (const option of options) {
      optionMap.set(this.toOptionMapKey(option.questionId, option.order), option.id)
    }

    return optionMap
  }

  private async updateScoreboard(
    subjectId: number,
    userId: number,
    scoreToAdd: number,
    trx: TransactionClient
  ): Promise<void> {
    const userScore = await Score.query({ client: trx })
      .where('subjectId', subjectId)
      .where('userId', userId)
      .forUpdate()
      .first()

    if (userScore) {
      userScore.score += scoreToAdd
      userScore.useTransaction(trx)
      await userScore.save()
      return
    }

    try {
      await Score.create(
        {
          score: scoreToAdd,
          userId,
          subjectId,
        },
        { client: trx }
      )
    } catch (error: any) {
      // Unique constraint violation — a concurrent request created the row
      // between our SELECT and INSERT. Re-read with lock and update.
      if (error.code === '23505') {
        const existing = await Score.query({ client: trx })
          .where('subjectId', subjectId)
          .where('userId', userId)
          .forUpdate()
          .firstOrFail()
        existing.score += scoreToAdd
        existing.useTransaction(trx)
        await existing.save()
      } else {
        throw error
      }
    }
  }

  private toOptionMapKey(questionId: number, optionOrder: string): string {
    return `${questionId}:${optionOrder}`
  }

  private normalizeOptionValue(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
      return null
    }

    const normalizedValue = value.trim().toUpperCase()
    return normalizedValue.length > 0 ? normalizedValue : null
  }

  private getValidatedCorrectOption(question: Question): string {
    const correctOption = this.normalizeOptionValue(question.correctOption)

    if (!correctOption || !/^[A-Z0-9]$/.test(correctOption)) {
      throw new Error(`Question ${question.id} has no valid correct option configured`)
    }

    return correctOption
  }
}
