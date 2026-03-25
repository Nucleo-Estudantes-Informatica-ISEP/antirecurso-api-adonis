import type { HttpContext } from '@adonisjs/core/http'
import ZitadelAuthService, { UnauthorizedError } from '#services/auth/zitadel_auth_service'

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
      if (error instanceof UnauthorizedError) {
        return ctx.response.unauthorized({ message: error.message })
      }

      throw error
    }
  }
}
