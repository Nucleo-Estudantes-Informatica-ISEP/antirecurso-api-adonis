import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import Question from '#models/question'
import QuestionReport from '#models/question_report'
import {
  createQuestionReportValidator,
  listQuestionReportsValidator,
  reviewQuestionReportsValidator,
} from '#validators/question_report'
import type { AuthenticatedHttpContext } from '../../contracts/auth.js'

export default class QuestionReportsController {
  private readonly allowedSortColumns = new Set([
    'id',
    'question_id',
    'created_at',
    'reason',
    'user_id',
    'reviewed_at',
    'solved',
    'reviewed_by',
  ])

  private relativeTime(value: DateTime | null): string | null {
    if (!value) {
      return null
    }

    return value.setLocale('pt-PT').toRelative() ?? value.toISO()
  }

  private serializeQuestionReport(report: QuestionReport) {
    return {
      id: report.id,
      reason: report.reason,
      question: {
        id: report.question.id,
        title: report.question.question,
        image: report.question.image,
        exam: report.question.exam,
        correct_option: report.question.correctOption,
        options: report.question.options.map((option) => ({
          id: option.id,
          name: option.name,
          order: option.order,
        })),
      },
      created_at: this.relativeTime(report.createdAt),
      updated_at: this.relativeTime(report.updatedAt),
      user: report.user.name,
      email: report.user.email,
      reviewed_at: report.reviewedAt?.toISO() ?? null,
      solved: Boolean(report.solved),
      reviewed_by: report.reviewedBy
        ? {
            name: report.reviewer.name,
            email: report.reviewer.email,
          }
        : null,
    }
  }

  /**
   * List question reports for the admin screens.
   * GET /question-reports
   */
  async index({ request, response }: HttpContext) {
    const data = await request.validateUsing(listQuestionReportsValidator, {
      data: {
        solved: request.input('solved'),
        sort: request.input('sort'),
        order: request.input('order'),
      },
    })

    const query = QuestionReport.query()
      .preload('user')
      .preload('reviewer')
      .preload('question', (questionQuery) => {
        questionQuery.preload('options')
      })

    if (data.solved !== undefined) {
      query.where('solved', data.solved === 'true')
    }

    if (data.sort && this.allowedSortColumns.has(data.sort)) {
      query.orderBy(data.sort, data.order ?? 'asc')
    }

    const reports = await query

    return response.ok(reports.map((report) => this.serializeQuestionReport(report)))
  }

  /**
   * Create a new question report.
   * POST /question-reports
   */
  async store({ authUser, request, response }: AuthenticatedHttpContext) {
    const data = await request.validateUsing(createQuestionReportValidator)

    const question = await Question.find(data.question_id)
    if (!question) {
      return response.notFound({ message: 'Question not found' })
    }

    const report = await QuestionReport.create({
      reason: data.reason ?? null,
      questionId: data.question_id,
      userId: authUser.id,
      solved: false,
      reviewedAt: null,
      reviewedBy: null,
    })

    await report.load('user')
    await report.load('reviewer')
    await report.load('question', (questionQuery) => {
      questionQuery.preload('options')
    })

    return response.created(this.serializeQuestionReport(report))
  }

  /**
   * Show a single question report.
   * GET /question-reports/:id
   */
  async show({ params, response }: HttpContext) {
    const report = await QuestionReport.query()
      .where('id', params.id)
      .preload('user')
      .preload('reviewer')
      .preload('question', (questionQuery) => {
        questionQuery.preload('options')
      })
      .firstOrFail()

    return response.ok(this.serializeQuestionReport(report))
  }

  /**
   * Mark one or more reports as solved.
   * POST /question-reports/review
   */
  async review({ authUser, request, response }: AuthenticatedHttpContext) {
    const data = await request.validateUsing(reviewQuestionReportsValidator)

    const existingReportIds = await QuestionReport.query()
      .whereIn('id', data.question_ids)
      .select('id')

    if (existingReportIds.length !== data.question_ids.length) {
      return response.unprocessableEntity({
        message: 'One or more question report IDs are invalid',
      })
    }

    const now = DateTime.now()

    await QuestionReport.query().whereIn('id', data.question_ids).whereNull('reviewed_at').update({
      reviewed_at: now.toSQL(),
      solved: true,
      reviewed_by: authUser.id,
    })

    const reports = await QuestionReport.query()
      .whereIn('id', data.question_ids)
      .where('solved', true)
      .where('reviewed_by', authUser.id)
      .where('reviewed_at', now.toSQL())
      .preload('user')
      .preload('reviewer')
      .preload('question', (questionQuery) => {
        questionQuery.preload('options')
      })

    return response.ok(reports.map((report) => this.serializeQuestionReport(report)))
  }
}
