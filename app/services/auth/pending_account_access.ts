export function canAccessWithPendingAccount(input: {
  pending: boolean
  path: string
  method: string
}) {
  return (
    !input.pending ||
    (input.path === '/user' && input.method === 'GET') ||
    (input.path === '/user/account-resolution' && input.method === 'POST')
  )
}
