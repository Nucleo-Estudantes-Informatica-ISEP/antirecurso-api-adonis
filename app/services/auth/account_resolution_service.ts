export type AccountResolutionAction = 'keep' | 'discard'

type AccountResolutionOperations = {
  discardAccountData: () => Promise<void>
  deletePendingMarker: () => Promise<void>
  deleteUser: () => Promise<void>
  updateAuthSubject: () => Promise<void>
}

export async function performAccountResolution(
  action: AccountResolutionAction,
  operations: AccountResolutionOperations
) {
  if (action === 'discard') {
    await operations.discardAccountData()
    await operations.deletePendingMarker()
    await operations.deleteUser()
    return
  }

  await operations.updateAuthSubject()
  await operations.deletePendingMarker()
}
