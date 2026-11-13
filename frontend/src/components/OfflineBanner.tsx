import { useEffect, useState } from 'react'
import { useOnlineStatus } from '../native/network'

/** Only show after a sustained offline stretch — avoids Capacitor/browser false alarms. */
const OFFLINE_DELAY_MS = 4000

/** Thin offline strip - native + web. */
export default function OfflineBanner() {
  const online = useOnlineStatus()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (online) {
      setShow(false)
      return
    }
    const t = window.setTimeout(() => setShow(true), OFFLINE_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [online])

  if (!show) return null
  return (
    <div className="offline-banner" role="status">
      You&apos;re offline. Some features won&apos;t update until you reconnect.
    </div>
  )
}
