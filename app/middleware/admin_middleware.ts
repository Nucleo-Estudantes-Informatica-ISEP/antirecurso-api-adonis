import type { HttpContext } from '@adonisjs/core/http'

export default class AdminMiddleware {
  async handle(ctx: HttpContext, next: () => Promise<void>) {
    if (!ctx.authUser) {
      return ctx.response.unauthorized({ message: 'Authentication required' })
    }

    if (!ctx.authUser.isAdmin) {
      return ctx.response.forbidden({ message: 'You are not an admin' })
    }

    await next()
  }
}
