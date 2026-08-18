import AccountLinkPending from '#models/account_link_pending'

type PendingLookup = (userId: number) => Promise<boolean>

const defaultPendingLookup: PendingLookup = async (userId) => {
  return (await AccountLinkPending.findBy('userId', userId)) !== null
}

export async function canAccessWithPendingAccount(
  input: { userId: number; path: string; method: string },
  lookupPending: PendingLookup = defaultPendingLookup
) {
  const hasPendingAccount = await lookupPending(input.userId)
  if (!hasPendingAccount) return true

  return (
    (input.path === '/user' && input.method === 'GET') ||
    (input.path === '/user/account-resolution' && input.method === 'POST')
  )
}
