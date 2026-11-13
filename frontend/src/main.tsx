import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Solid icons only - avoid brands/regular webfonts on the critical path
import '@fortawesome/fontawesome-free/css/fontawesome.min.css'
import '@fortawesome/fontawesome-free/css/solid.min.css'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { apiBaseUrl, isNativeApp } from './native/platform'
import { initNativeShell } from './native/shell'
import {
  clearServiceWorkerReloadGuard,
  reloadOnceForServiceWorker,
} from './utils/appRefresh'

/** Wake a sleeping Render free instance as soon as the main module runs. */
function wakeApi() {
  const base = apiBaseUrl()
  if (!base) return
  void fetch(`${base}/health`, { method: 'GET', mode: 'cors', cache: 'no-store', keepalive: true }).catch(
    () => {},
  )
}

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

  clearServiceWorkerReloadGuard()

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline / unsupported */
    })
  })

  // New SW took control — silent reload once (no confirm / “refreshing” UI)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    reloadOnceForServiceWorker()
  })

  // Quietly look for updates when the tab comes back
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    void navigator.serviceWorker.getRegistration().then((reg) => reg?.update().catch(() => undefined))
  })
}

wakeApi()
// Mount React immediately - never block the UI on native plugin init
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
