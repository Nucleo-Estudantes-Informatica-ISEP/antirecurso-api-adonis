import { createHash } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import Answer from '#models/answer'
import ExamState from '#models/exam_state'
import Subject from '#models/subject'
import ExamGenerationService from '#services/exams/exam_generation_service'
import type { ExamMode } from '#services/exams/exam_config'
import {
  EXAM_HISTORY_PAGE_SIZE,
  MAX_CUSTOM_QUESTIONS,
  MIN_CUSTOM_QUESTIONS,
  modeRequiresUser,
} from '#services/exams/exam_config'
import ExamVerificationService from '#services/exams/exam_verification_service'
import { examHistoryValidator, generateExamValidator, verifyExamValidator } from '#validators/exam'
import type { AuthenticatedHttpContext } from '../../contracts/auth.js'
import { hasAuthNeiRole } from '#services/auth/auth_nei_roles'
import { canViewExamAttempt } from '#services/exams/exam_access_policy'

export default class ExamsController {
  private examGenerationService = new ExamGenerationService()
  private examVerificationService = new ExamVerificationService()

  /**
   * Generate an exam using one of the available modes.
   * GET /exams/generate/:subject_id
   */
  async generate({ authUser, params, request, response }: HttpContext) {
    const subjectId = this.parseNumericInput(params.subject_id)
    if (subjectId === null) {
      return response.badRequest({ message: 'Invalid subject id' })
    }

    const data = await request.validateUsing(generateExamValidator, {
      data: {
        mode: request.input('mode'),
        filter: request.input('filter'),
        n_of_questions: this.parseNumericInput(request.input('n_of_questions')) ?? undefined,
      },
    })

    const mode: ExamMode = data.mode ?? 'default'
    const subject = await Subject.find(subjectId)
    if (!subject) {
      return response.notFound({ message: 'Invalid subject' })
    }

    const userId = authUser?.id ?? null

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
  async verify({ authUser, request, response }: HttpContext) {
    const data = await request.validateUsing(verifyExamValidator)
    const mode: ExamMode = data.mode ?? 'default'

    const subject = await Subject.find(data.subject_id)
    if (!subject) {
      return response.notFound({ message: 'Invalid subject' })
    }

    const userId = authUser?.id ?? null

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
   * GET /exams?page=...
   */
  async index({ authUser, request, response }: AuthenticatedHttpContext) {
    const data = await request.validateUsing(examHistoryValidator, {
      data: {
        page: this.parseNumericInput(request.input('page')) ?? undefined,
      },
    })

    const page = data.page ?? 1
    const exams = await Answer.query()
      .where('user_id', authUser.id)
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
  async show({ authUser, authClaims, params, response }: AuthenticatedHttpContext) {
    const examId = this.parseNumericInput(params.id)
    if (examId === null) {
      return response.badRequest({ message: 'Invalid exam id' })
    }

    const examOwnership = await Answer.query().where('id', examId).first()
    if (!examOwnership) {
      return response.notFound({ message: 'Invalid answer' })
    }

    if (
      !canViewExamAttempt({
        authenticatedUserId: authUser.id,
        ownerUserId: examOwnership.userId,
        isAdmin: hasAuthNeiRole(authClaims, 'admin'),
      })
    ) {
      return response.forbidden({
        message: 'You are not authorized to view this exam attempt',
      })
    }

    const exam = await Answer.query()
      .where('id', examId)
      .preload('subject')
      .preload('questions', (answerQuestionsQuery) => {
        answerQuestionsQuery.orderBy('id', 'asc')
        answerQuestionsQuery.preload('question', (questionQuery) => {
          questionQuery.preload('options')
          questionQuery.preload('questionType')
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
        question: {
          id: question.id,
          question: question.question,
          correct_option: question.correctOption,
          question_type: question.questionType?.name ?? 'Multiple Choice',
          image: question.image ?? '',
        },
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
          created_at: comment.createdAt.toISO(),
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
    const [examsPerDay, examsPerSubject, examsPerMode] = await Promise.all([
      Answer.query()
        .select(db.raw('DATE(created_at) as date'))
        .count('* as count')
        .where('created_at', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        .groupByRaw('DATE(created_at)')
        .orderByRaw('DATE(created_at)'),
      Answer.query()
        .join('subjects', 'subjects.id', 'answers.subject_id')
        .select('subjects.name')
        .count('* as count')
        .groupBy('subjects.name'),
      Answer.query().select('mode').count('* as count').groupBy('mode'),
    ])

    return response.ok({
      exams_per_day: examsPerDay.map((row) => ({
        date: row.$extras.date,
        count: Number(row.$extras.count),
      })),
      exams_per_subject: examsPerSubject.map((row) => ({
        name: row.$extras.name,
        count: Number(row.$extras.count),
      })),
      exams_per_mode: examsPerMode.map((row) => ({
        mode: row.mode,
        count: Number(row.$extras.count),
      })),
    })
  }

  /**
   * Save exam state for the authenticated user.
   * POST /exams/state
   */
  async saveState({ authUser, request, response }: AuthenticatedHttpContext) {
    const subjectId = this.parseNumericInput(request.input('subject_id'))
    if (subjectId === null) {
      return response.badRequest({ message: 'Invalid subject id' })
    }

    const mode = request.input('mode', 'default')

    const state = await ExamState.query()
      .where('user_id', authUser.id)
      .where('subject_id', subjectId)
      .where('mode', mode)
      .first()

    const payload = request.input('state') || {}

    if (state) {
      await state.merge({ state: payload }).save()
      return response.ok({ id: state.id, state: state.state })
    }

    const newState = await ExamState.create({
      userId: authUser.id,
      subjectId,
      mode,
      state: payload,
      isCompleted: false,
    })

    return response.ok({ id: newState.id, state: newState.state })
  }

  /**
   * Get exam state for the authenticated user.
   * GET /exams/state?subject_id=1&mode=default
   */
  async getState({ authUser, request, response }: AuthenticatedHttpContext) {
    const subjectId = this.parseNumericInput(request.input('subject_id'))
    if (subjectId === null) {
      return response.badRequest({ message: 'Invalid subject id' })
    }

    const mode = request.input('mode', 'default')

    const state = await ExamState.query()
      .where('user_id', authUser.id)
      .where('subject_id', subjectId)
      .where('mode', mode)
      .where('isCompleted', false)
      .first()

    if (!state) {
      return response.ok({ state: null })
    }

    return response.ok({ state: state.state, id: state.id })
  }

  /**
   * Clear exam state for the authenticated user.
   * DELETE /exams/state?subject_id=1&mode=default
   */
  async clearState({ authUser, request, response }: AuthenticatedHttpContext) {
    const subjectId = this.parseNumericInput(request.input('subject_id'))
    if (subjectId === null) {
      return response.badRequest({ message: 'Invalid subject id' })
    }

    const mode = request.input('mode', 'default')

    await ExamState.query()
      .where('user_id', authUser.id)
      .where('subject_id', subjectId)
      .where('mode', mode)
      .delete()

    return response.noContent()
  }

  /**
   * List pending (in-progress) exams for the authenticated user.
   * GET /exams/pending
   */
  async pending({ authUser, response }: AuthenticatedHttpContext) {
    const states = await ExamState.query()
      .where('user_id', authUser.id)
      .where('isCompleted', false)
      .preload('subject')
      .orderBy('updatedAt', 'desc')

    return response.ok({
      data: states.map((state) => ({
        id: state.id,
        subject: state.subject.name,
        subject_id: state.subjectId,
        mode: state.mode,
        state: state.state,
        created_at: state.createdAt.toISO(),
        updated_at: state.updatedAt.toISO(),
      })),
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
  private md5(value: string): string {
    return createHash('md5').update(value).digest('hex')
  }
}
