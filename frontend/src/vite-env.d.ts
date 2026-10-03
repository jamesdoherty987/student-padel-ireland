/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin for production / Capacitor (e.g. https://api.example.com) */
  readonly VITE_API_URL?: string
  /** Public https site for QR / invites (e.g. https://studentpadel.ie) */
  readonly VITE_WEB_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
