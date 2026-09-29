import { apiBaseUrl } from '../native/platform'

/** Resolve profile/media URLs for split frontend/API hosts (PWA / Capacitor / production). */
export function mediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined
  if (url.startsWith('blob:') || url.startsWith('data:')) return url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  const base = apiBaseUrl()
  if (url.startsWith('/')) {
    // Prefer API host when known; otherwise same-origin (Vite proxy / reverse proxy).
    return base ? `${base}${url}` : url
  }
  return url
}
