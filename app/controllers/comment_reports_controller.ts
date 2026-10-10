import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Comment from '#models/comment'
import { visibleComments } from '#services/comment_visibility'
import { commentReportValidator, commentReviewValidator } from '#validators/comment'
import type { AuthenticatedHttpContext } from '../../contracts/auth.js'

export default class CommentReportsController {
  async store({ authUser, params, request, response }: AuthenticatedHttpContext) {
    const data = await request.validateUsing(commentReportValidator, {
      data: { ...request.all(), id: params.id },
    })
    const comment = await visibleComments(Comment.query(), authUser.id).where('id', data.id).first()
    if (!comment) return response.notFound({ message: 'Comment not found' })
    const created = await db
      .table('comment_reports')
      .insert({
        comment_id: comment.id,
        reporter_id: authUser.id,
        reason: data.reason,
        created_at: new Date(),
      })
      .onConflict(['comment_id', 'reporter_id'])
      .ignore()
      .returning('id')
    const report = await db
      .from('comment_reports')
      .where('comment_id', comment.id)
      .where('reporter_id', authUser.id)
      .firstOrFail()
    return response
      .status(created.length ? 201 : 200)
      .send({ id: report.id, status: report.status })
  }
  async index({ request, response }: AuthenticatedHttpContext) {
    const input = Number(request.input('page', 1))
    const page = Number.isFinite(input) ? Math.max(1, Math.trunc(input)) : 1
    const reports = await db
      .from('comment_reports')
      .join('comments', 'comments.id', 'comment_reports.comment_id')
      .select(
        'comment_reports.*',
        'comments.comment',
        'comments.user_id as author_id',
        'comments.question_id'
      )
      .where('comment_reports.status', 'pending')
      .orderBy('comment_reports.created_at', 'asc')
      .paginate(page, 20)
    return response.ok({
      meta: reports.getMeta(),
      data: reports.all().map((report) => ({
        id: report.id,
        reason: report.reason,
        reporter_id: report.reporter_id,
        created_at: report.created_at,
        status: report.status,
        comment: {
          id: report.comment_id,
          comment: report.comment,
          user_id: report.author_id,
          question_id: report.question_id,
        },
      })),
    })
  }
  async review({ authUser, params, request, response }: AuthenticatedHttpContext) {
    const data = await request.validateUsing(commentReviewValidator, {
      data: { ...request.all(), id: params.id },
    })
    const status = data.action === 'remove' ? 'removed' : 'dismissed'
    const outcome = await db.transaction(async (trx) => {
      const original = await trx.from('comment_reports').where('id', data.id).first()
      if (!original) return 'missing'
      const comment = await Comment.query()
        .useTransaction(trx)
        .where('id', original.comment_id)
        .forUpdate()
        .first()
      if (!comment) return 'missing'
      const report = await trx.from('comment_reports').where('id', data.id).forUpdate().first()
      if (!report) return 'missing'
      if (report.status !== 'pending') return report.status === status ? 'done' : 'conflict'
      if (data.action === 'remove') {
        comment.useTransaction(trx)
        comment.hiddenAt = DateTime.now()
        await comment.save()
      }
      const query = trx.from('comment_reports').where('status', 'pending')
      if (data.action === 'remove') query.where('comment_id', comment.id)
      else query.where('id', data.id)
      await query.update({ status, reviewed_by: authUser.id, reviewed_at: new Date() })
      return 'done'
    })
    if (outcome === 'missing') return response.notFound({ message: 'Report not found' })
    if (outcome === 'conflict') return response.conflict({ message: 'Report already reviewed' })
    return response.noContent()
  }
}
