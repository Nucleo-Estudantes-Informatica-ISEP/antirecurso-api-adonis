import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import Answer from '#models/answer'
import Subject from '#models/subject'
import User from '#models/user'
import ExamGenerationService from '#services/exams/exam_generation_service'
import type { ExamMode } from '#services/exams/exam_config'
import {
  EXAM_HISTORY_PAGE_SIZE,
  MAX_CUSTOM_QUESTIONS,
  MIN_CUSTOM_QUESTIONS,
  modeRequiresUser,
} from '#services/exams/exam_config'
import ExamVerificationService from '#services/exams/exam_verification_service'
import {
  examAdminStatsValidator,
  examHistoryValidator,
  generateExamValidator,
  verifyExamValidator,
} from '#validators/exam'

export default class ExamsController {
  private examGenerationService = new ExamGenerationService()
  private examVerificationService = new ExamVerificationService()

  /**
   * Generate an exam using one of the available modes.
   * GET /exams/generate/:subject_id
   */
  async generate({ params, request, response }: HttpContext) {
    const subjectId = this.parseNumericInput(params.subject_id)
    if (subjectId === null) {
      return response.badRequest({ error: 'Invalid subject id' })
    }

    const data = await request.validateUsing(generateExamValidator, {
      data: {
        mode: request.input('mode'),
        filter: request.input('filter'),
        user_id: this.parseNumericInput(request.input('user_id')) ?? undefined,
        n_of_questions: this.parseNumericInput(request.input('n_of_questions')) ?? undefined,
      },
    })

    const mode: ExamMode = data.mode ?? 'default'
    const subject = await Subject.find(subjectId)
    if (!subject) {
      return response.notFound({ error: 'Invalid subject' })
    }

    const userId = await this.resolveUserId(data.user_id ?? null)
    if (data.user_id !== undefined && userId === null) {
      return response.badRequest({ error: 'Invalid user' })
    }

    if (modeRequiresUser(mode) && userId === null) {
      return response.unauthorized({ error: 'You must be logged in to generate this exam mode' })
    }

    if (mode === 'custom' && data.n_of_questions === undefined) {
      return response.badRequest({
        error: `Custom mode requires n_of_questions (${MIN_CUSTOM_QUESTIONS}-${MAX_CUSTOM_QUESTIONS})`,
      })
    }

    const questions = await this.examGenerationService.generate({
      subject,
      mode,
      userId,
      nOfQuestions: data.n_of_questions ?? null,
      filter: data.filter ?? null,
    })

    return response.ok(questions)
  }

  /**
   * Verify an exam and calculate the final score.
   * POST /exams/verify
   */
  async verify({ request, response }: HttpContext) {
    const data = await request.validateUsing(verifyExamValidator)
    const mode: ExamMode = data.mode ?? 'default'

    const subject = await Subject.find(data.subject_id)
    if (!subject) {
      return response.notFound({ error: 'Invalid subject' })
    }

    const userId = await this.resolveUserId(data.user_id ?? null)
    if (data.user_id !== undefined && userId === null) {
      return response.badRequest({ error: 'Invalid user' })
    }

    if (mode === 'custom' && data.n_of_questions === undefined) {
      return response.badRequest({
        error: `Custom mode requires n_of_questions (${MIN_CUSTOM_QUESTIONS}-${MAX_CUSTOM_QUESTIONS})`,
      })
    }

    try {
      const result = await this.examVerificationService.verify({
        subject,
        mode,
        answers: data.answers,
        userId,
        time: data.time ?? null,
        nOfQuestions: data.n_of_questions ?? null,
        penalizingFactor: data.penalizing_factor ?? null,
      })

      return response.ok(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid exam payload'
      return response.badRequest({ error: message })
    }
  }

  /**
   * List a user's exam history (paginated).
   * GET /exams?user_id=...&page=...
   */
  async index({ request, response }: HttpContext) {
    const data = await request.validateUsing(examHistoryValidator, {
      data: {
        user_id: this.parseNumericInput(request.input('user_id')) ?? undefined,
        page: this.parseNumericInput(request.input('page')) ?? undefined,
      },
    })

    const user = await User.find(data.user_id)
    if (!user) {
      return response.badRequest({ error: 'Invalid user' })
    }

    const page = data.page ?? 1
    const exams = await Answer.query()
      .where('userId', user.id)
      .preload('subject')
      .orderBy('createdAt', 'desc')
      .paginate(page, EXAM_HISTORY_PAGE_SIZE)

    return response.ok({
      meta: exams.getMeta(),
      data: exams.all().map((exam) => ({
        id: exam.id,
        score: exam.score,
        subject: exam.subject.name,
        mode: exam.mode,
        time: exam.time,
        created_at: exam.createdAt.toISO(),
      })),
    })
  }

  /**
   * Show a detailed exam attempt with selected option, correct answer and comments.
   * GET /exams/:id
   */
  async show({ params, response }: HttpContext) {
    const examId = this.parseNumericInput(params.id)
    if (examId === null) {
      return response.badRequest({ error: 'Invalid exam id' })
    }

    const exam = await Answer.query()
      .where('id', examId)
      .preload('subject')
      .preload('questions', (answerQuestionsQuery) => {
        answerQuestionsQuery.preload('question', (questionQuery) => {
          questionQuery.preload('options')
          questionQuery.preload('comments', (commentsQuery) => {
            commentsQuery.orderBy('createdAt', 'desc').preload('user')
          })
        })
      })
      .first()

    if (!exam) {
      return response.notFound({ error: 'Invalid answer' })
    }

    const questions = exam.questions.map((answerQuestion) => {
      const question = answerQuestion.question

      return {
        question_id: question.id,
        question: question.question,
        selected_option_id: answerQuestion.optionId,
        options: question.options.map((option) => ({
          id: option.id,
          name: option.name,
          order: option.order,
        })),
        is_wrong: answerQuestion.isWrong,
        correct_option: question.correctOption,
        comments: question.comments.map((comment) => ({
          id: comment.id,
          comment: comment.comment,
          user: comment.user.name,
          question_id: comment.questionId,
          created_at: comment.createdAt.toRelative() ?? comment.createdAt.toISO(),
          is_admin: comment.user.isAdmin,
          user_avatar: this.md5(comment.user.email.trim().toLowerCase()),
        })),
      }
    })

    return response.ok({
      id: exam.id,
      score: exam.score,
      taken_at: exam.createdAt.toFormat('dd/MM/yyyy'),
      subject: exam.subject.name,
      questions,
    })
  }

  /**
   * Aggregated admin exam statistics.
   * GET /admin/exams?user_id=...
   */
  async stats({ request, response }: HttpContext) {
    const data = await request.validateUsing(examAdminStatsValidator, {
      data: {
        user_id: this.parseNumericInput(request.input('user_id')) ?? undefined,
      },
    })

    const adminUser = await User.find(data.user_id)
    if (!adminUser) {
      return response.badRequest({ error: 'Invalid user' })
    }

    if (!adminUser.isAdmin) {
      return response.forbidden({ message: 'You are not an admin' })
    }

    const answers = await Answer.query().preload('subject')
    const lastWeekThreshold = DateTime.now().minus({ days: 7 }).startOf('day')

    const examsPerDayMap = new Map<string, number>()
    const examsPerSubjectMap = new Map<string, number>()
    const examsPerModeMap = new Map<string, number>()

    for (const answer of answers) {
      examsPerSubjectMap.set(
        answer.subject.name,
        (examsPerSubjectMap.get(answer.subject.name) ?? 0) + 1
      )
      examsPerModeMap.set(answer.mode, (examsPerModeMap.get(answer.mode) ?? 0) + 1)

      if (answer.createdAt.toMillis() >= lastWeekThreshold.toMillis()) {
        const date = answer.createdAt.toISODate()
        if (date) {
          examsPerDayMap.set(date, (examsPerDayMap.get(date) ?? 0) + 1)
        }
      }
    }

    const examsPerDay = [...examsPerDayMap.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([date, count]) => ({ date, count }))

    const examsPerSubject = [...examsPerSubjectMap.entries()].map(([name, count]) => ({
      name,
      count,
    }))
    const examsPerMode = [...examsPerModeMap.entries()].map(([mode, count]) => ({ mode, count }))

    return response.ok({
      exams_per_day: examsPerDay,
      exams_per_subject: examsPerSubject,
      exams_per_mode: examsPerMode,
    })
  }

  private parseNumericInput(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }

    if (typeof value === 'string') {
      const parsedValue = Number(value)
      if (Number.isFinite(parsedValue)) {
        return parsedValue
      }
    }

    return null
  }

  private async resolveUserId(userId: number | null): Promise<number | null> {
    if (userId === null) {
      return null
    }

    const user = await User.find(userId)
    return user ? user.id : null
  }

  private md5(value: string): string {
    return createHash('md5').update(value).digest('hex')
  }
}
