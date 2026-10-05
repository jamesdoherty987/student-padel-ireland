import { useEffect, useMemo, useState } from 'react'

type FlipWordsProps = {
  words: string[]
  duration?: number
  className?: string
}

/**
 * Rotating word slot using CSS transitions (no framer-motion on the landing path).
 * A hidden sizer locks width to the longest word so enter/exit never sit side-by-side.
 */
export function FlipWords({ words, duration = 2800, className = '' }: FlipWordsProps) {
  const safeWords = useMemo(() => (words.length > 0 ? words : ['']), [words])
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)
  const currentWord = safeWords[index % safeWords.length] ?? ''
  const longest = useMemo(
    () => safeWords.reduce((a, b) => (a.length >= b.length ? a : b), ''),
    [safeWords],
  )

  useEffect(() => {
    setIndex(0)
    setVisible(true)
  }, [safeWords])

  useEffect(() => {
    if (safeWords.length <= 1) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    let flipTimer = 0
    const t = window.setInterval(() => {
      setVisible(false)
      flipTimer = window.setTimeout(() => {
        setIndex((i) => (i + 1) % safeWords.length)
        setVisible(true)
      }, 220)
    }, duration)
    return () => {
      window.clearInterval(t)
      window.clearTimeout(flipTimer)
    }
  }, [safeWords, duration])

  return (
    <span className={`flip-words ${className}`.trim()} aria-live="polite">
      <span className="flip-words-sizer" aria-hidden>
        {longest}
      </span>
      <span className={`flip-words-inner${visible ? ' is-in' : ' is-out'}`}>{currentWord}</span>
    </span>
  )
}
