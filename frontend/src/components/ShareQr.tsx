import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

export function ShareQr({
  url,
  openLabel = 'Open page',
}: {
  url: string
  openLabel?: string
}) {
  const [copied, setCopied] = useState(false)
  const display = url.replace(/^https?:\/\//, '')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      window.prompt('Copy this link', url)
    }
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
        <a className="btn btn-ghost btn-sm" href={url}>
          {openLabel}
        </a>
      </div>
    </div>
  )
}
