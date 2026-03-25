import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import type { AuthClaims } from '#services/auth/zitadel_auth_service'

declare module '@adonisjs/core/http' {
  interface HttpContext {
    authClaims?: AuthClaims
    authUser?: User
  }
}

export type AuthenticatedHttpContext = HttpContext & {
  authClaims: AuthClaims
  authUser: User
}
