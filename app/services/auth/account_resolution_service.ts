type AccountResolutionOperations = {
  deletePendingMarker: () => Promise<void>
  updateAuthSubject: () => Promise<void>
}

export async function performAccountResolution(operations: AccountResolutionOperations) {
  await operations.updateAuthSubject()
  await operations.deletePendingMarker()
}
