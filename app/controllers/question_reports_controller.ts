import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import QuestionReport from '#models/question_report'
import { createQuestionReportValidator, reviewQuestionReportsValidator } from '#validators/question_report'

export default class QuestionReportsController {
    /**
     * Serialize a QuestionReport with its relations into the API response shape.
     */
    private serialize(report: QuestionReport) {
        return {
            id: report.id,
            reason: report.reason,
            question: {
                id: report.question.id,
                title: report.question.question,
                image: report.question.image,
                exam: report.question.exam,
                correct_option: report.question.correctOption,
                options: report.question.options.map((opt) => ({
                    id: opt.id,
                    name: opt.name,
                    order: opt.order,
                })),
            },
            created_at: report.createdAt.toISO(),
            updated_at: report.updatedAt.toISO(),
            user: report.user.name,
            email: report.user.email,
            reviewed_at: report.reviewedAt?.toISO() ?? null,
            solved: report.solved,
            reviewed_by: report.reviewer
                ? { name: report.reviewer.name, email: report.reviewer.email }
                : null,
        }
    }

    /**
     * List question reports with optional filtering and sorting.
     * GET /question-reports?solved=true&sort=created_at&order=desc
     */
    async index({ request, response }: HttpContext) {
        const solved = request.input('solved')
        const sort = request.input('sort')
        const order = request.input('order', 'asc')

        const query = QuestionReport.query()
            .preload('question', (q) => q.preload('options'))
            .preload('user')
            .preload('reviewer')

        if (solved !== undefined) {
            query.where('solved', solved === 'true')
        }

        if (sort) {
            query.orderBy(sort, order)
        }

        const reports = await query.exec()

        return response.ok(reports.map((r) => this.serialize(r)))
    }

    /**
     * Create a new question report.
     * POST /question-reports
     */
    async store({ request, response }: HttpContext) {
        const data = await request.validateUsing(createQuestionReportValidator)

        // TODO: replace user_id with authenticated user when auth service is integrated
        const report = await QuestionReport.create({
            reason: data.reason ?? null,
            questionId: data.question_id,
            userId: data.user_id,
        })

        await report.load('question', (q) => q.preload('options'))
        await report.load('user')
        await report.load('reviewer')

        return response.created(this.serialize(report))
    }

    /**
     * Show a single question report by ID.
     * GET /question-reports/:id
     */
    async show({ params, response }: HttpContext) {
        const report = await QuestionReport.query()
            .where('id', params.id)
            .preload('question', (q) => q.preload('options'))
            .preload('user')
            .preload('reviewer')
            .firstOrFail()

        return response.ok(this.serialize(report))
    }

    /**
     * Bulk-mark question reports as reviewed/solved (admin).
     * POST /question-reports/review
     */
    async review({ request, response }: HttpContext) {
        // TODO: add admin check when auth service is integrated
        const data = await request.validateUsing(reviewQuestionReportsValidator)

        const now = DateTime.now()

        // Bulk update unreviewed reports
        await QuestionReport.query()
            .whereIn('id', data.question_ids)
            .whereNull('reviewed_at')
            .update({
                reviewed_at: now.toSQL(),
                solved: true,
                reviewed_by: data.user_id,
            })

        // Fetch the updated reports
        const updatedReports = await QuestionReport.query()
            .whereIn('id', data.question_ids)
            .where('solved', true)
            .where('reviewedBy', data.user_id)
            .preload('question', (q) => q.preload('options'))
            .preload('user')
            .preload('reviewer')
            .exec()

        return response.ok(updatedReports.map((r) => this.serialize(r)))
    }
}
