import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Share } from '@capacitor/share'
import { QRCodeSVG } from 'qrcode.react'
import { hapticLight, hapticSuccess } from '../native/haptics'
import { isNativeApp, publicWebOrigin } from '../native/platform'

function qrPixelSize() {
  if (typeof window === 'undefined') return 200
  // Keep scannable on phones; leave room for padding + safe areas
  return Math.max(160, Math.min(220, Math.floor(window.innerWidth - 72)))
}

export function ShareQr({
  url,
  openLabel = 'Open page',
}: {
  url: string
  openLabel?: string
}) {
  const [copied, setCopied] = useState(false)
  const [size, setSize] = useState(qrPixelSize)
  const navigate = useNavigate()
  const display = url.replace(/^https?:\/\//, '')
  const origin = publicWebOrigin()

  useEffect(() => {
    const onResize = () => setSize(qrPixelSize())
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Remount QR if the value or size changes (helps flaky mobile WebViews)
  const qrKey = useMemo(() => `${url}:${size}`, [url, size])

  const inAppPath = (() => {
    try {
      if (url.startsWith('/')) return url
      const parsed = new URL(url)
      if (parsed.origin === origin || parsed.hostname.endsWith('studentpadel.ie')) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`
      }
    } catch {
      /* ignore */
    }
    return null
  })()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      void hapticSuccess()
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      window.prompt('Copy this link', url)
    }
  }

  const shareOrOpen = async () => {
    void hapticLight()
    if (isNativeApp()) {
      try {
        const can = await Share.canShare()
        if (can.value) {
          await Share.share({ title: 'Student Padel Ireland', url, dialogTitle: 'Share invite' })
          return
        }
      } catch {
        /* fall through */
      }
      if (inAppPath) {
        navigate(inAppPath)
        return
      }
      await copy()
      return
    }
    if (inAppPath) {
      navigate(inAppPath)
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="qr-wrap">
      <div className="qr-canvas" aria-label="QR code">
        {url ? (
          <QRCodeSVG
            key={qrKey}
            value={url}
            size={size}
            level="M"
            marginSize={2}
            bgColor="#ffffff"
            fgColor="#0b3d2e"
            title={url}
          />
        ) : (
          <p className="qr-fallback muted">QR unavailable — use Copy link or Share instead.</p>
        )}
      </div>
      <code className="qr-url">{display}</code>
      <div className="qr-actions">
        <button type="button" className="btn btn-dark btn-sm" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void shareOrOpen()}>
          {isNativeApp() ? 'Share' : openLabel}
        </button>
      </div>
    </div>
  )
}
