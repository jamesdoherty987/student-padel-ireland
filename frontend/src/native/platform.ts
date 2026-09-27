import { Capacitor } from '@capacitor/core'

/** True when running inside a Capacitor iOS/Android shell (not Safari/Chrome PWA). */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

export function nativePlatform(): 'ios' | 'android' | 'web' {
  const p = Capacitor.getPlatform()
  if (p === 'ios' || p === 'android') return p
  return 'web'
}

/**
 * Public https origin used for QR codes, invite links, and App Store marketing.
 * Never use capacitor://localhost for shareable URLs.
 */
export function publicWebOrigin(): string {
  const fromEnv = (import.meta.env.VITE_WEB_ORIGIN as string | undefined)?.replace(/\/$/, '')
  if (fromEnv) return fromEnv
  if (typeof window !== 'undefined' && !isNativeApp()) {
    const { protocol, host } = window.location
    if (protocol === 'http:' || protocol === 'https:') {
      return `${protocol}//${host}`
    }
  }
  return 'https://studentpadelireland.ie'
}

/** Absolute API base — required in native builds (relative URLs hit the WebView host). */
export function apiBaseUrl(): string {
  const raw = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || ''
  if (raw) return raw
  if (isNativeApp()) {
    console.warn(
      '[SPI] VITE_API_URL is empty in a native build — API calls will fail. Set it before `npm run build`.',
    )
  }
  return ''
}
