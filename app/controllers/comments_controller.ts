import type { HttpContext } from '@adonisjs/core/http'
import Comment from '#models/comment'
import Question from '#models/question'
import { createCommentValidator } from '#validators/comment'

export default class CommentsController {
    /**
     * List comments with optional sorting.
     * GET /comments?sort=created_at&order=desc
     */
    async index({ request, response }: HttpContext) {
        const sort = request.input('sort')
        const order = request.input('order', 'asc')

        const query = Comment.query().preload('user')

        if (sort) {
            query.orderBy(sort, order)
        }

        const comments = await query.exec()

        return response.ok(
            comments.map((comment) => ({
                id: comment.id,
                comment: comment.comment,
                user: comment.user.name,
                question_id: comment.questionId,
                created_at: comment.createdAt.toISO(),
                is_admin: comment.user.isAdmin,
            }))
        )
    }

    /**
     * Create a new comment on a question.
     * POST /comments
     */
    async store({ request, response }: HttpContext) {
        const data = await request.validateUsing(createCommentValidator)

        // Verify the question exists
        const question = await Question.find(data.question_id)
        if (!question) {
            return response.notFound({ message: 'Question not found' })
        }

        // TODO: replace user_id with authenticated user when auth service is integrated
        const comment = await Comment.create({
            comment: data.comment,
            questionId: data.question_id,
            userId: data.user_id,
        })

        await comment.load('user')

        return response.created({
            id: comment.id,
            comment: comment.comment,
            user: comment.user.name,
            question_id: comment.questionId,
            created_at: comment.createdAt.toISO(),
            is_admin: comment.user.isAdmin,
        })
    }

    /**
     * Show a single comment by ID.
     * GET /comments/:id
     */
    async show({ params, response }: HttpContext) {
        const comment = await Comment.query()
            .where('id', params.id)
            .preload('user')
            .firstOrFail()

        return response.ok({
            id: comment.id,
            comment: comment.comment,
            user: comment.user.name,
            question_id: comment.questionId,
            created_at: comment.createdAt.toISO(),
            is_admin: comment.user.isAdmin,
        })
    }
}
