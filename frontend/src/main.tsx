import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './index.css'
import App from './App.tsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline / unsupported — ignore */
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
