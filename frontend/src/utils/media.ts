/** Resolve profile/media URLs for split frontend/API hosts (PWA / production). */
export function mediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) {
    return url
  }
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
  if (url.startsWith('/') && base) return `${base}${url}`
  return url
}
