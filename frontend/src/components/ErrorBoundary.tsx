import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * Catches render crashes so mobile users see a recovery UI instead of a blank white screen.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App render error', error, info.componentStack)
  }

  private reload = () => {
    window.location.reload()
  }

  private hardReset = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister()))
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch {
      /* ignore */
    }
    window.location.href = '/'
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          textAlign: 'center',
          background: '#0b3d2e',
          color: '#fff',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Something went wrong</h1>
        <p style={{ margin: 0, opacity: 0.85, maxWidth: 320, lineHeight: 1.45 }}>
          The page failed to load. Try again — if it keeps happening, clear the cached app data.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 8 }}>
          <button
            type="button"
            onClick={this.reload}
            style={{
              border: 0,
              borderRadius: 10,
              padding: '0.7rem 1.1rem',
              background: '#c8e600',
              color: '#0b3d2e',
              fontWeight: 700,
            }}
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => void this.hardReset()}
            style={{
              border: '1px solid rgba(255,255,255,0.35)',
              borderRadius: 10,
              padding: '0.7rem 1.1rem',
              background: 'transparent',
              color: '#fff',
              fontWeight: 600,
            }}
          >
            Clear cache & restart
          </button>
        </div>
      </div>
    )
  }
}
