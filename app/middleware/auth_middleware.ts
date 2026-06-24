import type { HttpContext } from '@adonisjs/core/http'
import ZitadelAuthService, { UnauthorizedError } from '#services/auth/zitadel_auth_service'
import env from '#start/env'

export default class AuthMiddleware {
  private authService = new ZitadelAuthService()

  async handle(ctx: HttpContext, next: () => Promise<void>) {
    try {
      const session = await this.authService.authenticateAuthorizationHeader(
        ctx.request.header('authorization')
      )

      ctx.authUser = session.user
      ctx.authClaims = session.claims

      const { default: AccountLinkPending } = await import('#models/account_link_pending')
      const pending = await AccountLinkPending.findBy('userId', session.user.id)
      if (pending) {
        const rawPath = ctx.request.url()
        const path = rawPath.includes('?') ? rawPath.split('?')[0] : rawPath
        const isAllowed =
          (path === '/user' && ctx.request.method() === 'GET') ||
          (path === '/user/account-resolution' && ctx.request.method() === 'POST')

        if (!isAllowed) {
          return ctx.response.forbidden({
            message: 'Account resolution required',
            requires_account_resolution: true,
          })
        }
      }

      await next()
    } catch (error) {
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
