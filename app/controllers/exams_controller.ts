import { createHash } from 'node:crypto'
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
  examHistoryValidator,
  examShowValidator,
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
      return response.badRequest({ message: 'Invalid subject id' })
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
      return response.notFound({ message: 'Invalid subject' })
    }

    const userId = await this.resolveUserId(data.user_id ?? null)
    if (data.user_id !== undefined && userId === null) {
      return response.badRequest({ message: 'Invalid user' })
    }

    if (modeRequiresUser(mode) && userId === null) {
      return response.unauthorized({ message: 'You must be logged in to generate this exam mode' })
    }

    if (mode === 'custom' && data.n_of_questions === undefined) {
      return response.badRequest({
        message: `Custom mode requires n_of_questions (${MIN_CUSTOM_QUESTIONS}-${MAX_CUSTOM_QUESTIONS})`,
      })
    }

    try {
      const questions = await this.examGenerationService.generate({
        subject,
        mode,
        userId,
        nOfQuestions: data.n_of_questions ?? null,
        filter: data.filter ?? null,
      })

      return response.ok(questions)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to generate exam'
      return response.badRequest({ message })
    }
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
      return response.notFound({ message: 'Invalid subject' })
    }

    const userId = await this.resolveUserId(data.user_id ?? null)
    if (data.user_id !== undefined && userId === null) {
      return response.badRequest({ message: 'Invalid user' })
    }

    if (mode === 'custom' && data.n_of_questions === undefined) {
      return response.badRequest({
        message: `Custom mode requires n_of_questions (${MIN_CUSTOM_QUESTIONS}-${MAX_CUSTOM_QUESTIONS})`,
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
      return response.badRequest({ message })
    }
  }

  /**
   * List a user's exam history (paginated).
   * GET /exams?requesting_user_id=...&user_id=...&page=...
   */
  async index({ request, response }: HttpContext) {
    const data = await request.validateUsing(examHistoryValidator, {
      data: {
        requesting_user_id:
          this.parseNumericInput(request.input('requesting_user_id')) ?? undefined,
        user_id: this.parseNumericInput(request.input('user_id')) ?? undefined,
        page: this.parseNumericInput(request.input('page')) ?? undefined,
      },
    })

    const requestingUser = await User.find(data.requesting_user_id)
    if (!requestingUser) {
      return response.badRequest({ message: 'Invalid requesting user' })
    }

    // Temporary guard while auth middleware is pending.
    // Replace this with ctx.auth.user-based authorization once auth is integrated.
    if (!requestingUser.isAdmin && requestingUser.id !== data.user_id) {
      return response.forbidden({
        message: 'You are not authorized to view this exam history',
      })
    }

    const user = await User.find(data.user_id)
    if (!user) {
      return response.badRequest({ message: 'Invalid user' })
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
  async show({ params, request, response }: HttpContext) {
    const examId = this.parseNumericInput(params.id)
    if (examId === null) {
      return response.badRequest({ message: 'Invalid exam id' })
    }

    const data = await request.validateUsing(examShowValidator, {
      data: {
        user_id: this.parseNumericInput(request.input('user_id')) ?? undefined,
      },
    })

    const requestingUser = await User.find(data.user_id)
    if (!requestingUser) {
      return response.badRequest({ message: 'Invalid user' })
    }

    const examOwnership = await Answer.query().where('id', examId).first()
    if (!examOwnership) {
      return response.notFound({ message: 'Invalid answer' })
    }

    if (!requestingUser.isAdmin && examOwnership.userId !== requestingUser.id) {
      return response.forbidden({
        message: 'You are not authorized to view this exam attempt',
      })
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
      return response.notFound({ message: 'Invalid answer' })
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
   * GET /admin/exams
   */
  async stats({ response }: HttpContext) {
    // Security hard-stop: this endpoint must use authenticated session context,
    // never client-provided user identifiers.
    // TODO: Replace with auth middleware + admin check from ctx.auth.user.
    // TODO: When re-enabling stats, compute aggregates at database level
    // (GROUP BY + COUNT) to avoid loading all answers in memory.
    return response.unauthorized({
      message: 'Authentication is required to access admin exam stats',
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
