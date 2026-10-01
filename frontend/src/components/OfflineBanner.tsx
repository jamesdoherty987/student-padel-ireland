import { useOnlineStatus } from '../native/network'

/** Thin offline strip — native + web. */
export default function OfflineBanner() {
  const online = useOnlineStatus()
  if (online) return null
  return (
    <div className="offline-banner" role="status">
      You&apos;re offline. Some features won&apos;t update until you reconnect.
    </div>
  )
}
