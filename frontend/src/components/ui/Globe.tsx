import { useEffect, useRef } from 'react'
import createGlobe from 'cobe'

type GlobeProps = {
  className?: string
}

const RAD_PER_MS = 0.0035 / 16.67

/** Aceternity-style spinning globe (cobe v2) — court green theme */
export function Globe({ className = '' }: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let phi = (-7.5 * Math.PI) / 180 + Math.PI
    let width = canvas.offsetWidth
    let raf = 0
    let last = performance.now()

    const onResize = () => {
      width = canvas.offsetWidth
      globe.update({ width: width * 2, height: width * 2 })
    }

    const globe = createGlobe(canvas, {
      devicePixelRatio: Math.min(window.devicePixelRatio || 2, 2),
      width: width * 2,
      height: width * 2,
      phi,
      theta: 0.28,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 16000,
      mapBrightness: 4.5,
      baseColor: [0.04, 0.18, 0.14],
      markerColor: [0.78, 0.9, 0],
      glowColor: [0.08, 0.28, 0.2],
      markerElevation: 0,
      markers: [
        // Anchor only — slim DOM pin is the visible marker
        { location: [53.3498, -6.2603], size: 0, id: 'ie' },
      ],
    })

    const tick = (now: number) => {
      const dt = Math.min(32, now - last)
      last = now
      // Frame-rate independent rotation keeps the anchored pin steadier
      phi += RAD_PER_MS * dt
      globe.update({ phi })
      raf = requestAnimationFrame(tick)
    }

    window.addEventListener('resize', onResize)
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      globe.destroy()
      window.removeEventListener('resize', onResize)
    }
  }, [])

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
