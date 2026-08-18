export function canViewExamAttempt(input: {
  authenticatedUserId: number
  ownerUserId: number | null
  isAdmin: boolean
}) {
  return input.isAdmin || input.ownerUserId === input.authenticatedUserId
}
