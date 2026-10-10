import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { safetyIdValidator } from '#validators/comment'
import type { AuthenticatedHttpContext } from '../../contracts/auth.js'

export default class UserBlocksController {
  async index({ authUser, request, response }: AuthenticatedHttpContext) {
    const input = Number(request.input('page', 1))
    const page = Number.isFinite(input) ? Math.max(1, Math.trunc(input)) : 1
    const users = await db
      .from('user_blocks')
      .join('users', 'users.id', 'user_blocks.blocked_user_id')
      .where('user_blocks.user_id', authUser.id)
      .select('users.id', 'users.name')
      .orderBy('users.id')
      .paginate(page, 20)
    return response.ok({ meta: users.getMeta(), data: users.all() })
  }
  async store({ authUser, params, request, response }: AuthenticatedHttpContext) {
    const { id } = await request.validateUsing(safetyIdValidator, { data: { id: params.id } })
    if (id === authUser.id)
      return response.unprocessableEntity({ message: 'Cannot block yourself' })
    if (!(await User.find(id))) return response.notFound({ message: 'User not found' })
    await db
      .table('user_blocks')
      .insert({ user_id: authUser.id, blocked_user_id: id })
      .onConflict(['user_id', 'blocked_user_id'])
      .ignore()
    return response.noContent()
  }
  async destroy({ authUser, params, request, response }: AuthenticatedHttpContext) {
    const { id } = await request.validateUsing(safetyIdValidator, { data: { id: params.id } })
    await db.from('user_blocks').where('user_id', authUser.id).where('blocked_user_id', id).delete()
    return response.noContent()
  }
}
