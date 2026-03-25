import type { HttpContext } from '@adonisjs/core/http'
import Comment from '#models/comment'
import Question from '#models/question'
import { createCommentValidator } from '#validators/comment'
import type { AuthenticatedHttpContext } from '../../contracts/auth.js'

export default class CommentsController {
  /**
   * List comments with optional sorting.
   * GET /comments?sort=created_at&order=desc
   */
  async index({ request, response }: HttpContext) {
    const ALLOWED_SORT_COLUMNS = ['created_at', 'id'] as const
    const ALLOWED_ORDER_DIRS = ['asc', 'desc'] as const

    const sortInput = request.input('sort')
    const orderInput = request.input('order', 'asc')

    const sort = ALLOWED_SORT_COLUMNS.includes(sortInput) ? sortInput : null
    const order = ALLOWED_ORDER_DIRS.includes(orderInput) ? orderInput : 'asc'

    const query = Comment.query().preload('user')

    if (sort) {
      query.orderBy(sort, order)
    }

    const pageInput = Number(request.input('page', 1))
    const perPageInput = Number(request.input('per_page', 20))

    const normalizedPage = Number.isFinite(pageInput) ? Math.trunc(pageInput) : 1
    const normalizedPerPage = Number.isFinite(perPageInput) ? Math.trunc(perPageInput) : 20

    const page = Math.max(1, normalizedPage)
    const perPage = Math.min(100, Math.max(1, normalizedPerPage))

    const comments = await query.paginate(page, perPage)

    return response.ok({
      meta: {
        total: comments.total,
        per_page: comments.perPage,
        current_page: comments.currentPage,
        last_page: comments.lastPage,
      },
      data: comments.all().map((comment) => ({
        id: comment.id,
        comment: comment.comment,
        user: comment.user.name,
        question_id: comment.questionId,
        created_at: comment.createdAt.toISO(),
        is_admin: comment.user.isAdmin,
      })),
    })
  }

  /**
   * Create a new comment on a question.
   * POST /comments
   */
  async store({ authUser, request, response }: AuthenticatedHttpContext) {
    const data = await request.validateUsing(createCommentValidator)

    // Verify the question exists
    const question = await Question.find(data.question_id)
    if (!question) {
      return response.notFound({ message: 'Question not found' })
    }

    const comment = await Comment.create({
      comment: data.comment,
      questionId: data.question_id,
      userId: authUser.id,
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
    const comment = await Comment.query().where('id', params.id).preload('user').firstOrFail()

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
