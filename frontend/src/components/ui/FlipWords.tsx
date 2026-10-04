import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

type FlipWordsProps = {
  words: string[]
  duration?: number
  className?: string
}

/**
 * Rotating word slot. A hidden sizer locks width to the longest word so
 * enter/exit never sit side-by-side (e.g. "LimerickBelfast").
 */
export function FlipWords({ words, duration = 2800, className = '' }: FlipWordsProps) {
  const safeWords = useMemo(() => (words.length > 0 ? words : ['']), [words])
  const [index, setIndex] = useState(0)
  const currentWord = safeWords[index % safeWords.length] ?? ''
  const longest = useMemo(
    () => safeWords.reduce((a, b) => (a.length >= b.length ? a : b), ''),
    [safeWords],
  )

  useEffect(() => {
    setIndex(0)
  }, [safeWords])

  useEffect(() => {
    if (safeWords.length <= 1) return
    const t = window.setInterval(() => {
      setIndex((i) => (i + 1) % safeWords.length)
    }, duration)
    return () => window.clearInterval(t)
  }, [safeWords, duration])

  return (
    <span className={`flip-words ${className}`.trim()} aria-live="polite">
      <span className="flip-words-sizer" aria-hidden>
        {longest}
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={currentWord}
          className="flip-words-inner"
          initial={{ opacity: 0, y: '0.35em' }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: '-0.35em' }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          {currentWord}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
