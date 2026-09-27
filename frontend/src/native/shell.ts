import { App, type URLOpenListenerEvent } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import { pathFromAppUrl } from './deepLink'
import { isNativeApp, nativePlatform } from './platform'

export { pathFromAppUrl } from './deepLink'

type DeepLinkHandler = (pathWithSearch: string) => void

let deepLinkHandler: DeepLinkHandler | null = null
let pendingDeepLinks: string[] = []
let nativeReady = false
let splashHideTimer: number | null = null

export function onNativeDeepLink(handler: DeepLinkHandler | null) {
  deepLinkHandler = handler
  if (!handler || !pendingDeepLinks.length) return
  const queued = [...pendingDeepLinks]
  pendingDeepLinks = []
  for (const path of queued) {
    handler(path)
  }
}

function dispatchDeepLink(url: string) {
  const path = pathFromAppUrl(url)
  if (!path || path === '/') return
  if (deepLinkHandler) {
    deepLinkHandler(path)
    return
  }
  if (!pendingDeepLinks.includes(path)) {
    pendingDeepLinks.push(path)
  }
}

/** Open Stripe Checkout (or any external https) outside the WebView. */
export async function openExternalUrl(url: string): Promise<void> {
  if (!isNativeApp()) {
    window.location.href = url
    return
  }
  await Browser.open({
    url,
    presentationStyle: 'fullscreen',
    toolbarColor: '#0b3d2e',
  })
}

export async function closeExternalBrowser(): Promise<void> {
  if (!isNativeApp()) return
  try {
    await Browser.close()
  } catch {
    /* already closed */
  }
}

/**
 * After Stripe (or any in-app browser) closes, run `onReturn`.
 * Prefers `browserFinished`; also listens for app foreground as a fallback
 * (only after the app has been backgrounded, so we don't fire immediately).
 * Returns a disposer that removes listeners.
 */
export async function whenExternalBrowserCloses(onReturn: () => void): Promise<() => void> {
  if (!isNativeApp()) {
    return () => undefined
  }

  let done = false
  let sawBackground = false
  let finished: PluginListenerHandle | undefined
  let state: PluginListenerHandle | undefined

  const cleanup = () => {
    void finished?.remove()
    void state?.remove()
    finished = undefined
    state = undefined
  }

  const finish = () => {
    if (done) return
    done = true
    cleanup()
    void closeExternalBrowser()
    onReturn()
  }

  finished = await Browser.addListener('browserFinished', finish)
  state = await App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) {
      sawBackground = true
      return
    }
    if (sawBackground) finish()
  })

  return () => {
    done = true
    cleanup()
  }
}

export async function hideNativeSplash(): Promise<void> {
  if (!isNativeApp()) return
  if (splashHideTimer != null) {
    window.clearTimeout(splashHideTimer)
    splashHideTimer = null
  }
  try {
    await SplashScreen.hide({ fadeOutDuration: 280 })
  } catch {
    /* already hidden */
  }
}

/**
 * Native shell bootstrap — status bar, keyboard, deep links.
 * Call once from main.tsx before React render; splash hides after router mount.
 */
export async function initNativeShell(): Promise<void> {
  if (!isNativeApp() || nativeReady) return
  nativeReady = true

  document.documentElement.classList.add('native-app')
  document.documentElement.classList.add(`native-${nativePlatform()}`)

  try {
    await StatusBar.setStyle({ style: Style.Dark })
    if (nativePlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#0b3d2e' })
    }
  } catch {
    /* StatusBar unavailable on some simulators */
  }

  try {
    await Keyboard.setAccessoryBarVisible({ isVisible: true })
  } catch {
    /* iOS only / optional */
  }

  void App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    dispatchDeepLink(event.url)
    void closeExternalBrowser()
  })

  try {
    const launch = await App.getLaunchUrl()
    if (launch?.url) {
      dispatchDeepLink(launch.url)
    }
  } catch {
    /* no launch URL */
  }

  // Safety: never leave the splash up if React fails to mount
  splashHideTimer = window.setTimeout(() => {
    splashHideTimer = null
    void hideNativeSplash()
  }, 4000)
}
