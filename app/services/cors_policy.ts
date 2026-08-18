export function parseAllowedOrigins(value: string | undefined) {
  return new Set(
    (value ?? '')
      .split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean)
  )
}

export function resolveAllowedOrigin(origin: string | undefined, allowedOrigins: Set<string>) {
  if (!origin) return null

  const normalizedOrigin = origin.replace(/\/$/, '')
  return allowedOrigins.has(normalizedOrigin) ? normalizedOrigin : null
}
