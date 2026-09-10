import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import AccountLinkPending from '#models/account_link_pending'
import Answer from '#models/answer'
import Score from '#models/score'
import QuestionReport from '#models/question_report'
import { searchUsersValidator } from '#validators/user'
import type { AuthenticatedHttpContext } from '../../contracts/auth.js'
import { serializeUserIdentity } from '#services/auth/user_identity'
import {
  performAccountResolution,
  type AccountResolutionAction,
} from '#services/auth/account_resolution_service'

export default class UsersController {
  /**
   * Get the current user's session info.
   * GET /user
   */
  async session({ authUser, authClaims, response }: AuthenticatedHttpContext) {
    const pending = await AccountLinkPending.findBy('userId', authUser.id)
    const requiresAccountResolution = pending !== null

    let accountSummary = null
    if (requiresAccountResolution && pending) {
      // Fazemos as duas contagens na mesma query usando as relações do Model!
      const userCounts = await User.query()
        .where('id', authUser.id)
        .withCount('scores')
        .withCount('answers')
        .first()

      accountSummary = {
        email: authClaims.email,
        pending_auth_subject: pending.authSubject,
        scores: Number((userCounts as any)?.['$extras.scores_count'] ?? 0),
        answers: Number((userCounts as any)?.['$extras.answers_count'] ?? 0),
      }
    }

    return response.ok({
      ...serializeUserIdentity(authUser, authClaims),
      requires_account_resolution: requiresAccountResolution,
      account_summary: accountSummary,
    })
  }

  async scores({ authUser, authClaims, response }: AuthenticatedHttpContext) {
    await authUser.load('scores', (query) => {
      query.preload('subject')
    })

    const subjectIds = authUser.scores.map((s) => s.subjectId)

    let countsMap = new Map<number, number>()
    if (subjectIds.length > 0) {
      const answersCountQuery = await Answer.query()
        .where('userId', authUser.id)
        .whereIn('subjectId', subjectIds)
        .select('subjectId')
        .count('* as total')
        .groupBy('subjectId')

      for (const row of answersCountQuery) {
        countsMap.set(row.subjectId, Number(row.$extras.total))
      }
    }

    return response.ok(
      authUser.scores.map((score) => {
        const totalTests = countsMap.get(score.subjectId) || 1
        return {
          score: score.score / totalTests,
          subject_id: score.subjectId,
          subject: score.subject.name,
          user: authClaims.name,
          show_scoreboard: score.showScoreboard,
        }
      })
    )
  }

  async accountResolution({ authUser, request, response }: AuthenticatedHttpContext) {
    const action = request.input('action')

    if (action !== 'keep' && action !== 'discard') {
      return response.badRequest({ message: 'Invalid action' })
    }

    const resolved = await db.transaction(async (trx) => {
      const pending = await AccountLinkPending.query()
        .useTransaction(trx)
        .where('userId', authUser.id)
        .forUpdate()
        .first()

      if (!pending) return false

      await performAccountResolution(action as AccountResolutionAction, {
        discardAccountData: async () => {
          await Answer.query().useTransaction(trx).where('userId', authUser.id).delete()
          await Score.query().useTransaction(trx).where('userId', authUser.id).delete()
          await QuestionReport.query().useTransaction(trx).where('userId', authUser.id).delete()
        },
        deletePendingMarker: async () => {
          await AccountLinkPending.query().useTransaction(trx).where('id', pending.id).delete()
        },
        deleteUser: async () => {
          await User.query().useTransaction(trx).where('id', authUser.id).delete()
        },
        updateAuthSubject: async () => {
          await User.query()
            .useTransaction(trx)
            .where('id', authUser.id)
            .update({ authSubject: pending.authSubject })
        },
      })

      return true
    })

    if (!resolved) {
      return response.badRequest({ message: 'No pending account resolution' })
    }

    return response.ok({
      message:
        action === 'discard'
          ? 'Account data discarded successfully'
          : 'Account linked successfully',
    })
  }

  /**
   * Get the current user's answers (exam history).
   * GET /user/answers
   */
  async answers({ authUser, authClaims, response }: AuthenticatedHttpContext) {
    await authUser.load('answers', (query) => {
      query.preload('subject')
    })

    return response.ok(
      authUser.answers.map((answer) => ({
        id: answer.id,
        score: answer.score,
        subject: answer.subject.name,
        user_name: authClaims.name,
        mode: answer.mode,
        time: answer.time,
        created_at: answer.createdAt.toISO(),
      }))
    )
  }

  /**
   * Search users by name or email (admin only).
   * GET /search?query=...
   */
  async search({ request, response }: HttpContext) {
    const data = await request.validateUsing(searchUsersValidator, {
      data: { query: request.input('query') },
    })

    let page = Number(request.input('page', 1))
    if (!Number.isFinite(page) || page < 1) {
      page = 1
    }

    const users = await User.query()
      .where('name', 'ilike', `%${data.query}%`)
      .orWhere('email', 'ilike', `%${data.query}%`)
      .paginate(page, 15)

    return response.ok({
      meta: users.getMeta(),
      data: users.all().map((user) => serializeUserIdentity(user)),
    })
  }

  /**
   * List all users (admin only).
   * GET /users
   */
  async listUsers({ request, response }: HttpContext) {
    let page = Number(request.input('page', 1))
    if (!Number.isFinite(page) || page < 1) {
      page = 1
    }

    const users = await User.query().paginate(page, 15)

    return response.ok({
      meta: users.getMeta(),
      data: users.all().map((user) => serializeUserIdentity(user)),
    })
  }

  /**
   * Get admin session info.
   * GET /admin
   */
  async adminSession({ authUser, authClaims, response }: AuthenticatedHttpContext) {
    return response.ok({
      ...serializeUserIdentity(authUser, authClaims),
    })
  }
}
