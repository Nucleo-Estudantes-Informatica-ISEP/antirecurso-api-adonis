export function getRateLimitKey(userId: number | undefined, ipAddress: string): string {
  return userId === undefined ? `ip:${ipAddress}` : `user:${userId}`
}
