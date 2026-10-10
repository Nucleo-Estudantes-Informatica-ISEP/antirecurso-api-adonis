import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import Answer from '#models/answer'
import ExamAttempt from '#models/exam_attempt'
import User from '#models/user'
import ExamState from '#models/exam_state'
import Question from '#models/question'
import Subject from '#models/subject'
import ExamGenerationService from '#services/exams/exam_generation_service'
import type { ExamMode } from '#services/exams/exam_config'
import {
  EXAM_HISTORY_PAGE_SIZE,
  MAX_CUSTOM_QUESTIONS,
  MIN_CUSTOM_QUESTIONS,
  modeRequiresUser,
} from '#services/exams/exam_config'
import ExamVerificationService, {
  AttemptConflictError,
} from '#services/exams/exam_verification_service'
import {
  examHistoryValidator,
  examStateIdentifierValidator,
  generateExamValidator,
  saveExamStateValidator,
  verifyExamValidator,
} from '#validators/exam'
import type { AuthenticatedHttpContext } from '../../contracts/auth.js'
import { hasAuthNeiRole } from '#services/auth/auth_nei_roles'
import { canViewExamAttempt } from '#services/exams/exam_access_policy'
import { InvalidExamStateError, normalizeSavedExamState } from '#services/exams/exam_state_policy'
import { getUserAvatar } from '#services/auth/user_identity'

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
        attempt_id: request.input('attempt_id'),
        penalizing_factor: this.parseNumericInput(request.input('penalizing_factor')) ?? undefined,
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
        attemptId: data.attempt_id,
        penalizingFactor: data.penalizing_factor ?? null,
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
        attemptId: data.attempt_id,
      })

      return response.ok(result)
    } catch (error) {
      if (error instanceof AttemptConflictError)
        return response.conflict({ message: error.message })
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

    const immutable = await ExamAttempt.query()
      .where('user_id', exam.userId!)
      .whereRaw("result->>'id' = ?", [String(exam.id)])
      .first()
    const questions = exam.questions.map((answerQuestion) => {
      const question = answerQuestion.question
      const snapshot = immutable?.snapshot.questions.find((item) => item.id === question.id)

      return {
        question: {
          id: question.id,
          question: snapshot?.question ?? question.question,
          correct_option: snapshot?.correctOption ?? question.correctOption,
          question_type:
            snapshot?.question_type ?? question.questionType?.name ?? 'Multiple Choice',
          image: snapshot?.image ?? question.image ?? '',
        },
        selected_option_id: answerQuestion.optionId,
        options: (snapshot?.options ?? question.options).map((option) => ({
          id: option.id,
          name: option.name,
          order: option.order,
        })),
        is_wrong: answerQuestion.isWrong,
        correct_option: snapshot?.correctOption ?? question.correctOption,
        comments: question.comments.map((comment) => ({
          id: comment.id,
          comment: comment.comment,
          user: comment.user.name,
          question_id: comment.questionId,
          created_at: comment.createdAt.toISO(),
          user_avatar: getUserAvatar(comment.user.email),
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
    const data = await request.validateUsing(saveExamStateValidator)
    const subject = await Subject.find(data.subject_id)
    if (!subject) return response.notFound({ message: 'Invalid subject' })

    let payload
    try {
      payload = normalizeSavedExamState(data.state, data.subject_id, data.mode)
    } catch (error) {
      if (error instanceof InvalidExamStateError) {
        return response.badRequest({ message: error.message })
      }
      throw error
    }

    const matchingQuestionCount = await Question.query()
      .where('subject_id', data.subject_id)
      .whereIn('id', payload.questionIds)
      .count('* as total')
      .first()
    if (Number(matchingQuestionCount?.$extras.total ?? 0) !== payload.questionIds.length) {
      return response.badRequest({ message: 'Exam state contains questions from another subject' })
    }

    return db.transaction(async (trx) => {
      // Lock the owner even when no state exists, so competing initial saves cannot both win.
      await User.query({ client: trx }).where('id', authUser.id).forUpdate().firstOrFail()
      const state = await ExamState.query({ client: trx })
        .where('user_id', authUser.id)
        .where('subject_id', data.subject_id)
        .where('mode', data.mode)
        .forUpdate()
        .first()
      const active = state && !state.isCompleted ? state : null
      if (
        data.expected_revision !== undefined &&
        (data.expected_revision !== (active?.revision ?? 0) ||
          (active && data.expected_state_id !== active.id))
      ) {
        return response.conflict({ message: 'Exam state revision changed' })
      }
      if (state?.isCompleted && !data.restart_completed) {
        return response.conflict({ message: 'Completed exam state cannot be modified' })
      }
      if (data.attempt_id) {
        const attempt = await ExamAttempt.query({ client: trx })
          .where('id', data.attempt_id)
          .where('user_id', authUser.id)
          .where('subject_id', data.subject_id)
          .where('mode', data.mode)
          .first()
        if (
          !attempt ||
          attempt.result ||
          JSON.stringify(attempt.snapshot.questions.map((item) => item.id)) !==
            JSON.stringify(payload.questionIds)
        ) {
          return response.conflict({
            message: 'Attempt is unavailable, completed or has different questions',
          })
        }
      }
      const saved = state ?? new ExamState()
      saved.useTransaction(trx)
      saved.merge({
        userId: authUser.id,
        subjectId: data.subject_id,
        mode: data.mode,
        state: payload,
        isCompleted: false,
        revision: (state?.revision ?? 0) + 1,
        attemptId:
          data.attempt_id ??
          (active &&
          JSON.stringify(payload.questionIds) === JSON.stringify(active.state.questionIds)
            ? active.attemptId
            : null),
      })
      await saved.save()
      return response.ok({
        id: saved.id,
        revision: saved.revision,
        attempt_id: saved.attemptId,
        state: { ...saved.state, savedAt: saved.updatedAt.toMillis() },
      })
    })
  }

  /**
   * Get exam state for the authenticated user.
   * GET /exams/state?subject_id=1&mode=default
   */
  async getState({ authUser, request, response }: AuthenticatedHttpContext) {
    const data = await request.validateUsing(examStateIdentifierValidator, {
      data: {
        subject_id: this.parseNumericInput(request.input('subject_id')) ?? undefined,
        mode: request.input('mode', 'default'),
      },
    })

    const state = await ExamState.query()
      .where('user_id', authUser.id)
      .where('subject_id', data.subject_id)
      .where('mode', data.mode)
      .where('isCompleted', false)
      .first()

    if (!state) {
      return response.ok({ state: null })
    }

    try {
      const normalizedState = normalizeSavedExamState(state.state, data.subject_id, data.mode)
      return response.ok({
        state: { ...normalizedState, savedAt: state.updatedAt.toMillis() },
        id: state.id,
        revision: state.revision,
        attempt_id: state.attemptId,
      })
    } catch (error) {
      if (error instanceof InvalidExamStateError) {
        return response.ok({ state: null })
      }
      throw error
    }
  }

  /**
   * Clear exam state for the authenticated user.
   * DELETE /exams/state?subject_id=1&mode=default
   */
  async clearState({ authUser, request, response }: AuthenticatedHttpContext) {
    const data = await request.validateUsing(examStateIdentifierValidator, {
      data: {
        subject_id: this.parseNumericInput(request.input('subject_id')) ?? undefined,
        mode: request.input('mode', 'default'),
      },
    })

    const revision = request.input('expected_revision')
    const stateId = request.input('expected_state_id')
    if (
      revision !== undefined &&
      (!/^\d+$/.test(String(revision)) ||
        (Number(revision) > 0 && !/^[1-9]\d*$/.test(String(stateId))))
    ) {
      return response.badRequest({ message: 'Invalid expected state revision' })
    }
    return db.transaction(async (trx) => {
      await User.query({ client: trx }).where('id', authUser.id).forUpdate().firstOrFail()
      const state = await ExamState.query({ client: trx })
        .where('user_id', authUser.id)
        .where('subject_id', data.subject_id)
        .where('mode', data.mode)
        .forUpdate()
        .first()
      const active = state && !state.isCompleted ? state : null
      if (
        revision !== undefined &&
        (Number(revision) !== (active?.revision ?? 0) || (active && Number(stateId) !== active.id))
      ) {
        return response.conflict({ message: 'Exam state revision changed' })
      }
      if (state) await state.delete()
      return response.noContent()
    })
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
      data: states.flatMap((state) => {
        try {
          const normalizedState = normalizeSavedExamState(
            state.state,
            state.subjectId,
            state.mode as ExamMode
          )
          return [
            {
              id: state.id,
              revision: state.revision,
              attempt_id: state.attemptId,
              subject: state.subject.name,
              subject_id: state.subjectId,
              mode: state.mode,
              state: { ...normalizedState, savedAt: state.updatedAt.toMillis() },
              created_at: state.createdAt.toISO(),
              updated_at: state.updatedAt.toISO(),
            },
          ]
        } catch (error) {
          if (error instanceof InvalidExamStateError) return []
          throw error
        }
      }),
    })
  }
  async recoverAttempt({ authUser, params, response }: HttpContext) {
    if (
      typeof params.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.id)
    ) {
      return response.badRequest({ message: 'Invalid attempt ID' })
    }
    const attempt = await ExamAttempt.find(params.id)
    if (!attempt || attempt.userId !== (authUser?.id ?? null))
      return response.notFound({ message: 'Attempt unavailable' })
    return response.ok({
      id: attempt.id,
      result: attempt.result,
      questions: attempt.snapshot.questions.map(
        ({ correctOption: _correct, options, ...question }) => ({
          ...question,
          options: options.map(({ id: _id, ...option }) => option),
        })
      ),
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
}
