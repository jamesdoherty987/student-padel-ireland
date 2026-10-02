import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { isNativeApp } from './native/platform'
import { initNativeShell } from './native/shell'

function mount() {
  const root = document.getElementById('root')
  if (!root) return
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

function registerServiceWorker() {
  if (isNativeApp() || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline / unsupported */
    })
  })
  // If a new SW takes over after a bad deploy, reload once to pick up matching chunks
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })
}

// Mount React immediately — never block the UI on native plugin init
mount()
registerServiceWorker()

if (isNativeApp()) {
  void initNativeShell().catch((err) => {
    console.warn('Native shell init failed', err)
  })
}

// Recover from failed dynamic imports / stale PWA chunks (common white-screen cause)
window.addEventListener('unhandledrejection', (event) => {
  const msg = String((event.reason as { message?: string })?.message || event.reason || '')
  if (/Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/i.test(msg)) {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        void Promise.all(regs.map((r) => r.unregister())).finally(() => {
          window.location.reload()
        })
      })
    } else {
      window.location.reload()
    }
  }
})
