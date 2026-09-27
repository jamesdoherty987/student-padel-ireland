import { StatusBar, Style } from '@capacitor/status-bar'
import { isNativeApp, nativePlatform } from './platform'

/** Light status-bar icons (for dark backgrounds). */
export async function setStatusBarForDarkScreen() {
  if (!isNativeApp()) return
  try {
    await StatusBar.setStyle({ style: Style.Dark })
    if (nativePlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#0b3d2e' })
    }
  } catch {
    /* unavailable */
  }
}

/** Dark status-bar icons (for light chrome — default app surfaces). */
export async function setStatusBarForLightScreen() {
  if (!isNativeApp()) return
  try {
    await StatusBar.setStyle({ style: Style.Light })
    if (nativePlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#ffffff' })
    }
  } catch {
    /* unavailable */
  }
}
