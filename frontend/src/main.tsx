import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './index.css'
import App from './App.tsx'
import { isNativeApp } from './native/platform'
import { initNativeShell } from './native/shell'

async function boot() {
  // PWA service worker fights Capacitor's local asset hosting - web/PWA only
  if (!isNativeApp() && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* offline / unsupported - ignore */
      })
    })
  }

  if (isNativeApp()) {
    await initNativeShell()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
