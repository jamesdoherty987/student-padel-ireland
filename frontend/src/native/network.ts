import { useEffect, useState } from 'react'
import { Network } from '@capacitor/network'
import { isNativeApp } from './platform'

/** Subscribe to online/offline. On web uses navigator.onLine. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )

  useEffect(() => {
    if (!isNativeApp()) {
      const on = () => setOnline(true)
      const off = () => setOnline(false)
      window.addEventListener('online', on)
      window.addEventListener('offline', off)
      return () => {
        window.removeEventListener('online', on)
        window.removeEventListener('offline', off)
      }
    }

    let handle: { remove: () => Promise<void> } | undefined
    void (async () => {
      try {
        const status = await Network.getStatus()
        setOnline(status.connected)
        handle = await Network.addListener('networkStatusChange', (s) => {
          setOnline(s.connected)
        })
      } catch {
        /* Network plugin unavailable */
      }
    })()

    return () => {
      void handle?.remove()
    }
  }, [])

  return online
}
