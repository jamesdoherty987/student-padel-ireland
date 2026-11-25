import type { QueryClient } from '@tanstack/react-query'
import { isNativeApp } from '../native/platform'

const SW_RELOAD_KEY = 'spi-sw-reloaded'

/** Dispatched when a new service worker is waiting (PWA only). */
export const PWA_UPDATE_EVENT = 'spi:pwa-update-available'

declare global {
  interface Window {
    /** Stash waiting SW if the update event fires before React mounts. */
    __SPI_WAITING_SW?: ServiceWorker | null
  }
}

export function stashPendingWaitingServiceWorker(worker: ServiceWorker): void {
  window.__SPI_WAITING_SW = worker
  window.dispatchEvent(new CustomEvent(PWA_UPDATE_EVENT))
}

/** Keep the waiting worker without re-firing the update event (e.g. after a stolen dialog). */
export function rememberWaitingServiceWorker(worker: ServiceWorker): void {
  window.__SPI_WAITING_SW = worker
}

export function getPendingWaitingServiceWorker(): ServiceWorker | null {
  return window.__SPI_WAITING_SW ?? null
}

export function clearPendingWaitingServiceWorker(): void {
  window.__SPI_WAITING_SW = null
}

/** Soft refresh: refetch queries without a full page reload / popup. */
export async function softRefreshApp(qc: QueryClient): Promise<void> {
  await qc.invalidateQueries({ refetchType: 'active' })
  if (isNativeApp() || !('serviceWorker' in navigator)) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.update().catch(() => undefined)))
  } catch {
    /* ignore */
  }
}

/** Tell a waiting service worker to activate (user chose Update). */
export async function applyWaitingServiceWorker(): Promise<boolean> {
  if (isNativeApp() || !('serviceWorker' in navigator)) return false
  try {
    const pending = getPendingWaitingServiceWorker()
    const reg = await navigator.serviceWorker.getRegistration()
    const waiting = reg?.waiting || pending
    if (!waiting) return false
    waiting.postMessage({ type: 'SKIP_WAITING' })
    clearPendingWaitingServiceWorker()
    return true
  } catch {
    return false
  }
}

/** Hard reload once after SW takeover. */
export function reloadOnceForServiceWorker(): void {
  try {
    if (sessionStorage.getItem(SW_RELOAD_KEY) === '1') return
    sessionStorage.setItem(SW_RELOAD_KEY, '1')
  } catch {
    /* private mode */
  }
  window.location.reload()
}

export function clearServiceWorkerReloadGuard(): void {
  try {
    sessionStorage.removeItem(SW_RELOAD_KEY)
  } catch {
    /* ignore */
  }
}
