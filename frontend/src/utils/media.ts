import { apiBaseUrl } from '../native/platform'

/** Resolve profile/media URLs for split frontend/API hosts (PWA / Capacitor / production). */
export function mediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) {
    return url
  }
  const base = apiBaseUrl()
  if (url.startsWith('/') && base) return `${base}${url}`
  return url
}
