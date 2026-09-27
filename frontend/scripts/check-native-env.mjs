/**
 * Fail native builds that would ship without an API host.
 * Usage: node scripts/check-native-env.mjs
 */
const api = (process.env.VITE_API_URL || '').trim()

if (!api) {
  console.error(`
[native] VITE_API_URL is required for Capacitor builds.

The iOS/Android WebView cannot use the Vite dev proxy. Set an absolute API URL, then rebuild:

  export VITE_API_URL=https://your-api.onrender.com
  export VITE_WEB_ORIGIN=https://studentpadelireland.ie
  npm run build:native

`)
  process.exit(1)
}

if (!/^https?:\/\//i.test(api)) {
  console.error(`[native] VITE_API_URL must be an absolute http(s) URL, got: ${api}`)
  process.exit(1)
}

console.log(`[native] VITE_API_URL=${api.replace(/\/$/, '')}`)
if (process.env.VITE_WEB_ORIGIN) {
  console.log(`[native] VITE_WEB_ORIGIN=${process.env.VITE_WEB_ORIGIN.replace(/\/$/, '')}`)
} else {
  console.warn('[native] VITE_WEB_ORIGIN unset — QR/invite links default to https://studentpadelireland.ie')
}
