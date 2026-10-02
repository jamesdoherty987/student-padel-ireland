import { useEffect, useRef, useState } from 'react'
import createGlobe from 'cobe'

type GlobeProps = {
  className?: string
}

const RAD_PER_MS = 0.0035 / 16.67

/** Aceternity-style spinning globe (cobe v2) - court green theme. Soft-fails on weak mobile GPUs. */
export function Globe({ className = '' }: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || failed) return

    let phi = (-7.5 * Math.PI) / 180 + Math.PI
    let width = canvas.offsetWidth || 280
    let raf = 0
    let last = performance.now()
    let globe: ReturnType<typeof createGlobe> | null = null

    try {
      const onResize = () => {
        if (!globe) return
        width = canvas.offsetWidth || 280
        globe.update({ width: width * 2, height: width * 2 })
      }

      globe = createGlobe(canvas, {
        devicePixelRatio: Math.min(window.devicePixelRatio || 2, 2),
        width: width * 2,
        height: width * 2,
        phi,
        theta: 0.28,
        dark: 1,
        diffuse: 1.2,
        mapSamples: 12000,
        mapBrightness: 4.5,
        baseColor: [0.04, 0.18, 0.14],
        markerColor: [0.78, 0.9, 0],
        glowColor: [0.08, 0.28, 0.2],
        markerElevation: 0,
        markers: [{ location: [53.3498, -6.2603], size: 0, id: 'ie' }],
      })

      const tick = (now: number) => {
        if (!globe) return
        const dt = Math.min(32, now - last)
        last = now
        phi += RAD_PER_MS * dt
        globe.update({ phi })
        raf = requestAnimationFrame(tick)
      }

      window.addEventListener('resize', onResize)
      raf = requestAnimationFrame(tick)

      return () => {
        cancelAnimationFrame(raf)
        window.removeEventListener('resize', onResize)
        try {
          globe?.destroy()
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.warn('Globe unavailable on this device', err)
      setFailed(true)
      return
    }
  }, [failed])

  if (failed) {
    return <div className={`globe-wrap globe-wrap--static ${className}`.trim()} aria-hidden />
  }

  return (
    <div className={`globe-wrap ${className}`.trim()}>
      <canvas
        ref={canvasRef}
        className="globe-canvas"
        style={{ width: '100%', height: '100%', contain: 'layout paint size' }}
        aria-hidden
      />
      <div className="globe-pin" aria-hidden>
        <svg className="globe-pin-svg" viewBox="0 0 24 36" fill="none">
          <path
            d="M12 1.5C7.3 1.5 3.5 5.3 3.5 10c0 6.2 8.5 23 8.5 23s8.5-16.8 8.5-23c0-4.7-3.8-8.5-8.5-8.5Z"
            fill="#c8e600"
          />
          <circle cx="12" cy="10" r="3.2" fill="#0b3d2e" />
        </svg>
      </div>
    </div>
  )
}
