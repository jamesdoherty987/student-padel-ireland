import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Share } from '@capacitor/share'
import { QRCodeSVG } from 'qrcode.react'
import { hapticLight, hapticSuccess } from '../native/haptics'
import { isNativeApp, publicWebOrigin } from '../native/platform'

export function ShareQr({
  url,
  openLabel = 'Open page',
}: {
  url: string
  openLabel?: string
}) {
  const [copied, setCopied] = useState(false)
  const navigate = useNavigate()
  const display = url.replace(/^https?:\/\//, '')
  const origin = publicWebOrigin()

  const inAppPath = (() => {
    try {
      if (url.startsWith('/')) return url
      const parsed = new URL(url)
      if (parsed.origin === origin || parsed.hostname.endsWith('studentpadelireland.ie')) {
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
      <div className="qr-canvas">
        <QRCodeSVG
          value={url}
          size={220}
          level="H"
          marginSize={4}
          bgColor="#ffffff"
          fgColor="#0b3d2e"
          title={url}
        />
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
