/** Allow only same-origin relative paths (blocks //evil.com open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = ''): string {
  if (!next) return fallback
  const trimmed = next.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback
  return trimmed
}

/** Default post-login / home destination for a role. */
export function homeForRole(role: string | undefined | null): string {
  return role === 'ADMIN' ? '/admin' : '/tournaments'
}
