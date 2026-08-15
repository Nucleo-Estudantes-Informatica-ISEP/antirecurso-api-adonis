import type { HttpContext } from '@adonisjs/core/http'
import ZitadelAuthService, {
  ForbiddenError,
  UnauthorizedError,
} from '#services/auth/zitadel_auth_service'
import env from '#start/env'

export default class OptionalAuthMiddleware {
  private authService = new ZitadelAuthService()

  async handle(ctx: HttpContext, next: () => Promise<void>) {
    const authorizationHeader = ctx.request.header('authorization')

    if (!authorizationHeader) {
      await next()
      return
    }

    try {
      const session = await this.authService.authenticateAuthorizationHeader(authorizationHeader)

      ctx.authUser = session.user
      ctx.authClaims = session.claims

      await next()
    } catch (error) {
      if (error instanceof ForbiddenError) {
        // Route is public. A valid AuthNEI identity without the app's student role
        // continues anonymously; malformed/invalid credentials still receive 401 below.
        await next()
        return
      }

      if (error instanceof UnauthorizedError) {
        if (env.get('AUTH_DEBUG')) {
          console.warn('[auth][api]', {
            middleware: 'optionalAuth',
            path: ctx.request.url(),
            method: ctx.request.method(),
            message: error.message,
            hasAuthorizationHeader: Boolean(authorizationHeader),
          })
        }

        return ctx.response.unauthorized({ message: error.message })
      }

      throw error
    }
  }
}
