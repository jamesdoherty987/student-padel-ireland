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

/** Extract ProfileMedia UUID from `/api/media/{uuid}` style URLs. */
export function mediaIdFromUrl(url?: string | null): string | null {
  if (!url) return null
  const m = String(url).match(/\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  return m?.[1] ?? null
}
