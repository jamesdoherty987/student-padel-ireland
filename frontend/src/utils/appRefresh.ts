import type { QueryClient } from '@tanstack/react-query'
import { isNativeApp } from '../native/platform'

const SW_RELOAD_KEY = 'spi-sw-reloaded'

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

/** Apply a waiting service worker, then reload once (no confirm UI). */
export async function applyWaitingServiceWorker(): Promise<boolean> {
  if (isNativeApp() || !('serviceWorker' in navigator)) return false
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg?.waiting) return false
    reg.waiting.postMessage({ type: 'SKIP_WAITING' })
    // Fallback if the worker ignores the message
    try {
      // skipWaiting is already called on install in sw.js; activate + claim still need a reload
      reg.waiting.postMessage({ type: 'SKIP_WAITING' })
    } catch {
      /* ignore */
    }
    return true
  } catch {
    return false
  }
}

/** Hard reload once after SW takeover — silent, no dialog. */
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
