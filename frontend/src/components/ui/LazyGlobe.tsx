import { lazy, Suspense, useEffect, useRef, useState } from 'react'

const Globe = lazy(() => import('./Globe').then((m) => ({ default: m.Globe })))

/** Mount the WebGL globe only when scrolled near the section (and not on tiny/weak viewports). */
export function LazyGlobe({ className = '' }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return

    // Skip WebGL on very small screens / data-saver — keeps mobile first paint light
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
      ?.saveData
    const narrow = window.matchMedia('(max-width: 640px)').matches
    if (saveData || narrow) return

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setReady(true)
          io.disconnect()
        }
      },
      { rootMargin: '120px 0px', threshold: 0.05 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={hostRef} className={className} style={{ minHeight: '12rem' }}>
      {ready ? (
        <Suspense fallback={<div className="globe-wrap globe-wrap--static" aria-hidden />}>
          <Globe />
        </Suspense>
      ) : (
        <div className="globe-wrap globe-wrap--static" aria-hidden />
      )}
    </div>
  )
}
