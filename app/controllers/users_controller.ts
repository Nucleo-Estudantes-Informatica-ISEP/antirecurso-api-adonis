import ZitadelAuthService, { UnauthorizedError } from '#services/auth/zitadel_auth_service'
import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import Answer from '#models/answer'
import { searchUsersValidator } from '#validators/user'
import {
  deleteAccount,
  DeletionStorageError,
  SharedNoteError,
} from '#services/auth/account_deletion'
import type { AuthenticatedHttpContext } from '../../contracts/auth.js'
import { serializeUserIdentity } from '#services/auth/user_identity'

export default class UsersController {
  async revokeSession({ request, response }: HttpContext) {
    try {
      await new ZitadelAuthService().revokeAuthorizationHeader(request.header('authorization'))
      return response.noContent()
    } catch (error) {
      if (error instanceof UnauthorizedError)
        return response.unauthorized({ message: error.message })
      throw error
    }
  }

  async destroy({ authUser, authClaims, request, response }: AuthenticatedHttpContext) {
    if (
      (request.header('x-antirecurso-confirmation') ?? request.input('confirmation')) !==
      'DELETE_ANTIRECURSO_DATA'
    )
      return response.unprocessableEntity({ message: 'Confirm deletion of AntiRecurso data' })
    try {
      await deleteAccount(authUser.id, authClaims.sub)
      return response.noContent()
    } catch (error) {
      if (error instanceof DeletionStorageError)
        return response.serviceUnavailable({ message: error.message })
      if (error instanceof SharedNoteError) return response.conflict({ message: error.message })
      throw error
    }
  }

  /**
   * Get the current user's session info.
   * GET /user
   */
  async session({ authUser, authClaims, response }: AuthenticatedHttpContext) {
    const requiresAccountResolution = authUser.authSubject === null

    let accountSummary = null
    if (requiresAccountResolution) {
      // Fazemos as duas contagens na mesma query usando as relações do Model!
      const userCounts = await User.query()
        .where('id', authUser.id)
        .withCount('scores')
        .withCount('answers')
        .first()

      accountSummary = {
        email: authClaims.email,
        pending_auth_subject: authClaims.sub,
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

  async accountResolution({ authUser, authClaims, request, response }: AuthenticatedHttpContext) {
    if (request.input('action') !== 'keep') {
      return response.badRequest({ message: 'Only account linking is supported here' })
    }

    if (authUser.authSubject !== authClaims.sub || authUser.email !== authClaims.email) {
      return response.forbidden({ message: 'Contact support to recover the existing account' })
    }

    return response.ok({ message: 'Account already linked' })
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
