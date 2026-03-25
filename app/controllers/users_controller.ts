import { createHash } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { searchUsersValidator } from '#validators/user'
import type { AuthenticatedHttpContext } from '../../contracts/auth.js'

export default class UsersController {
  /**
   * Serialize a user into the API response shape.
   * Matches Laravel's UserResource.
   */
  private serializeUser(user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: this.md5(user.email.trim().toLowerCase()),
      is_admin: user.isAdmin,
    }
  }

  /**
   * Get the current user's session info.
   * GET /user
   */
  async session({ authUser, response }: AuthenticatedHttpContext) {
    return response.ok(this.serializeUser(authUser))
  }

  /**
   * Get the current user's scores.
   * GET /user/scores
   */
  async scores({ authUser, response }: AuthenticatedHttpContext) {
    await authUser.load('scores', (query) => {
      query.preload('subject')
    })

    return response.ok(
      authUser.scores.map((score) => ({
        score: score.score,
        subject_id: score.subjectId,
        subject: score.subject.name,
        user: authUser.name,
        show_scoreboard: score.showScoreboard,
      }))
    )
  }

  /**
   * Get the current user's answers (exam history).
   * GET /user/answers
   */
  async answers({ authUser, response }: AuthenticatedHttpContext) {
    await authUser.load('answers', (query) => {
      query.preload('subject')
    })

    return response.ok(
      authUser.answers.map((answer) => ({
        id: answer.id,
        score: answer.score,
        subject: answer.subject.name,
        user_name: authUser.name,
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
      data: users.all().map((user) => this.serializeUser(user)),
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
      data: users.all().map((user) => this.serializeUser(user)),
    })
  }

  /**
   * Get admin session info.
   * GET /admin
   */
  async adminSession({ authUser, response }: AuthenticatedHttpContext) {
    return response.ok(this.serializeUser(authUser))
  }

  private md5(value: string): string {
    return createHash('md5').update(value).digest('hex')
  }
}
