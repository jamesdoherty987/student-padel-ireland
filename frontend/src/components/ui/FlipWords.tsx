import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

type FlipWordsProps = {
  words: string[]
  duration?: number
  className?: string
}

export function FlipWords({ words, duration = 2800, className = '' }: FlipWordsProps) {
  const [currentWord, setCurrentWord] = useState(words[0] ?? '')
  const [isAnimating, setIsAnimating] = useState(false)

  const startAnimation = useCallback(() => {
    const next = words[(words.indexOf(currentWord) + 1) % words.length] ?? words[0]
    setCurrentWord(next)
    setIsAnimating(true)
  }, [currentWord, words])

  useEffect(() => {
    if (isAnimating) return
    const t = window.setTimeout(startAnimation, duration)
    return () => window.clearTimeout(t)
  }, [isAnimating, duration, startAnimation])

  return (
    <span className={`flip-words ${className}`.trim()}>
      <AnimatePresence
        onExitComplete={() => {
          setIsAnimating(false)
        }}
      >
        <motion.span
          key={currentWord}
          className="flip-words-inner"
          initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -18, filter: 'blur(6px)', position: 'absolute' }}
          transition={{ type: 'spring', stiffness: 120, damping: 14 }}
        >
          {currentWord}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
