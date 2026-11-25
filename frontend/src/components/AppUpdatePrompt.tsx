import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { confirmDialog, isConfirmDialogOpen } from './ConfirmDialog'
import { isNativeApp, nativePlatform } from '../native/platform'
import { openStoreUrl } from '../native/shell'
import { platformApi } from '../services/api'
import { isSemverNewer } from '../utils/semver'
import { APP_STORE_URL, PLAY_STORE_URL } from '../utils/storeUrls'
import {
  PWA_UPDATE_EVENT,
  applyWaitingServiceWorker,
  clearPendingWaitingServiceWorker,
  getPendingWaitingServiceWorker,
  reloadOnceForServiceWorker,
  rememberWaitingServiceWorker,
} from '../utils/appRefresh'

const DISMISS_KEY = 'spi-update-dismissed'

/** Module lock so React StrictMode remounts cannot double-open the prompt. */
let offeringUpdate = false

function wasDismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function dismissForSession(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* private mode */
  }
}

async function resolveWaitingWorker(
  hint?: ServiceWorker | null,
): Promise<ServiceWorker | null> {
  if (hint) return hint
  const stashed = getPendingWaitingServiceWorker()
  if (stashed) return stashed
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    return reg?.waiting ?? null
  } catch {
    return null
  }
}

/**
 * Soft “Update available” prompt for native store builds and PWA shell updates.
 * Later dismisses for the session only — never forced.
 */
export default function AppUpdatePrompt() {
  useEffect(() => {
    let cancelled = false
    const timers = new Set<number>()

    const later = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        timers.delete(id)
        if (!cancelled) fn()
      }, ms)
      timers.add(id)
    }

    const runNativeCheck = async () => {
      if (!isNativeApp() || wasDismissedThisSession() || offeringUpdate) return
      const platform = nativePlatform()
      if (platform !== 'ios' && platform !== 'android') return

      offeringUpdate = true
      try {
        const info = await App.getInfo()
        const current = String(info.version || '').trim()
        if (!current) return

        const { data } = await platformApi.appVersion()
        if (wasDismissedThisSession()) return

        const policy = platform === 'ios' ? data.ios : data.android
        const latest = String(policy?.latest || '').trim()
        if (!latest || !isSemverNewer(latest, current)) return

        const storeUrl =
          String(policy?.store_url || '').trim() ||
          (platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL)

        if (isConfirmDialogOpen()) {
          if (!cancelled) {
            later(1800, () => {
              void runNativeCheck()
            })
          }
          return
        }

        const result = await confirmDialog({
          title: 'Update available',
          message: `A newer version of Student Padel Ireland is ready (${latest}). Update now for the latest fixes and features.`,
          confirmLabel: 'Update',
          cancelLabel: 'Later',
        })

        // Honor the user's choice even if this effect was cleaned up (StrictMode)
        if (result === null) {
          if (!cancelled) {
            later(1800, () => {
              void runNativeCheck()
            })
          }
          return
        }
        if (result === false) {
          dismissForSession()
          return
        }
        await openStoreUrl(storeUrl)
      } catch {
        /* offline / plugin / API — skip quietly */
      } finally {
        offeringUpdate = false
      }
    }

    const runPwaCheck = async (waiting?: ServiceWorker | null) => {
      if (isNativeApp() || wasDismissedThisSession() || offeringUpdate) return

      const worker = await resolveWaitingWorker(waiting)
      if (!worker) return

      // Clear stash before offering so mount + event don't double-prompt
      clearPendingWaitingServiceWorker()
      offeringUpdate = true
      try {
        if (wasDismissedThisSession()) {
          rememberWaitingServiceWorker(worker)
          return
        }

        if (isConfirmDialogOpen()) {
          rememberWaitingServiceWorker(worker)
          if (!cancelled) {
            later(1800, () => {
              void runPwaCheck()
            })
          }
          return
        }

        const result = await confirmDialog({
          title: 'Update available',
          message:
            'A newer version of the app is ready. Update now to get the latest improvements.',
          confirmLabel: 'Update',
          cancelLabel: 'Later',
        })

        // Honor Later / Update even after effect cleanup; only skip retries when cancelled
        if (result === null) {
          rememberWaitingServiceWorker(worker)
          if (!cancelled) {
            later(1800, () => {
              void runPwaCheck()
            })
          }
          return
        }
        if (result === false) {
          dismissForSession()
          return
        }

        try {
          worker.postMessage({ type: 'SKIP_WAITING' })
        } catch {
          const applied = await applyWaitingServiceWorker()
          if (!applied) {
            reloadOnceForServiceWorker()
            return
          }
        }
        // Primary path: controllerchange → reloadOnceForServiceWorker
        window.setTimeout(() => reloadOnceForServiceWorker(), 2500)
      } finally {
        offeringUpdate = false
      }
    }

    if (isNativeApp()) {
      // Short delay so splash / first paint / confirm provider settle
      later(1200, () => {
        void runNativeCheck()
      })
    } else {
      // Delay so ConfirmDialogProvider can subscribe first
      later(100, () => {
        void runPwaCheck()
      })
      const onPwaUpdate = () => {
        void runPwaCheck()
      }
      window.addEventListener(PWA_UPDATE_EVENT, onPwaUpdate)
      return () => {
        cancelled = true
        timers.forEach((id) => window.clearTimeout(id))
        timers.clear()
        window.removeEventListener(PWA_UPDATE_EVENT, onPwaUpdate)
      }
    }

    return () => {
      cancelled = true
      timers.forEach((id) => window.clearTimeout(id))
      timers.clear()
    }
  }, [])

  return null
}
