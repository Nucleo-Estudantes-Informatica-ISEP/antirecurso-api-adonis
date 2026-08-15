import type { HttpContext } from '@adonisjs/core/http'
import { hasAuthNeiRole } from '#services/auth/auth_nei_roles'

export default class AdminMiddleware {
  async handle(ctx: HttpContext, next: () => Promise<void>) {
    if (!ctx.authUser) {
      return ctx.response.unauthorized({ message: 'Authentication required' })
    }

    if (!hasAuthNeiRole(ctx.authClaims, 'admin')) {
      return ctx.response.forbidden({ message: 'You are not an admin' })
    }

    await next()
  }
}
