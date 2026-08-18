import type { HttpContext } from '@adonisjs/core/http'
import ZitadelAuthService, {
  ForbiddenError,
  UnauthorizedError,
} from '#services/auth/zitadel_auth_service'
import env from '#start/env'
import { canAccessWithPendingAccount } from '#services/auth/pending_account_access'

export default class AuthMiddleware {
  private authService = new ZitadelAuthService()

  async handle(ctx: HttpContext, next: () => Promise<void>) {
    try {
      const session = await this.authService.authenticateAuthorizationHeader(
        ctx.request.header('authorization')
      )

      ctx.authUser = session.user
      ctx.authClaims = session.claims

      const rawPath = ctx.request.url()
      const path = rawPath.includes('?') ? rawPath.split('?')[0] : rawPath
      const isAllowed = await canAccessWithPendingAccount({
        userId: session.user.id,
        path,
        method: ctx.request.method(),
      })

      if (!isAllowed) {
        return ctx.response.forbidden({
          message: 'Account resolution required',
          requires_account_resolution: true,
        })
      }

      await next()
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return ctx.response.forbidden({ message: error.message })
      }

      if (error instanceof UnauthorizedError) {
        if (env.get('AUTH_DEBUG')) {
          console.warn('[auth][api]', {
            middleware: 'auth',
            path: ctx.request.url(),
            method: ctx.request.method(),
            message: error.message,
            hasAuthorizationHeader: Boolean(ctx.request.header('authorization')),
          })
        }

        return ctx.response.unauthorized({ message: error.message })
      }

      throw error
    }
  }
}
