/*
|--------------------------------------------------------------------------
| Define HTTP limiters
|--------------------------------------------------------------------------
|
| The "limiter.define" method creates an HTTP middleware to apply rate
| limits on a route or a group of routes. Feel free to define as many
| throttle middleware as needed.
|
*/

import limiter from '@adonisjs/limiter/services/main'
import { getRateLimitKey } from '#services/security/rate_limit_policy'

export const examThrottle = limiter.define('exam', (ctx) => {
  return limiter
    .allowRequests(20)
    .every('1 minute')
    .blockFor('5 minutes')
    .usingKey(getRateLimitKey(ctx.authUser?.id, ctx.request.ip()))
})

export const mutationThrottle = limiter.define('mutation', (ctx) => {
  return limiter
    .allowRequests(30)
    .every('1 minute')
    .blockFor('5 minutes')
    .usingKey(getRateLimitKey(ctx.authUser?.id, ctx.request.ip()))
})

export const uploadThrottle = limiter.define('upload', (ctx) => {
  return limiter
    .allowRequests(10)
    .every('5 minutes')
    .blockFor('15 minutes')
    .usingKey(getRateLimitKey(ctx.authUser?.id, ctx.request.ip()))
})

export const accountResolutionThrottle = limiter.define('account-resolution', (ctx) => {
  return limiter
    .allowRequests(5)
    .every('15 minutes')
    .blockFor('1 hour')
    .usingKey(getRateLimitKey(ctx.authUser?.id, ctx.request.ip()))
})
