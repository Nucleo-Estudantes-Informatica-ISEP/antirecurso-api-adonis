import type { HttpContext } from '@adonisjs/core/http'
import ZitadelAuthService, { UnauthorizedError } from '#services/auth/zitadel_auth_service'

export default class AuthMiddleware {
  private authService = new ZitadelAuthService()

  async handle(ctx: HttpContext, next: () => Promise<void>) {
    try {
      const session = await this.authService.authenticateAuthorizationHeader(
        ctx.request.header('authorization')
      )

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
