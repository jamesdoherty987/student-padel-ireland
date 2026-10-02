import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { isNativeApp } from './platform'

export async function hapticLight(): Promise<void> {
  if (!isNativeApp()) return
  try {
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    /* simulator / unavailable */
  }
}

export async function hapticMedium(): Promise<void> {
  if (!isNativeApp()) return
  try {
    await Haptics.impact({ style: ImpactStyle.Medium })
  } catch {
    /* simulator / unavailable */
  }
}

export async function hapticSuccess(): Promise<void> {
  if (!isNativeApp()) return
  try {
    await Haptics.notification({ type: NotificationType.Success })
  } catch {
    /* simulator / unavailable */
  }
}
