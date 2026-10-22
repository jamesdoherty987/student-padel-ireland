import { useEffect } from 'react'
import { Keyboard } from '@capacitor/keyboard'
import { isNativeApp } from '../native/platform'

/**
 * Publishes --keyboard-inset on :root so sheets/forms can pad above the iOS keyboard.
 * Uses Capacitor Keyboard when available, with visualViewport as a fallback.
 */
export function useKeyboardInset(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    const root = document.documentElement
    const setInset = (px: number) => {
      root.style.setProperty('--keyboard-inset', `${Math.max(0, Math.round(px))}px`)
    }
    const clear = () => setInset(0)

    let cancelled = false
    let removeCap: (() => void) | undefined
    let usingCapacitor = false

    if (isNativeApp()) {
      void (async () => {
        const handles: { remove: () => Promise<void> }[] = []
        try {
          handles.push(
            await Keyboard.addListener('keyboardWillShow', (info) => {
              usingCapacitor = true
              setInset(info.keyboardHeight)
            }),
          )
          handles.push(
            await Keyboard.addListener('keyboardDidShow', (info) => {
              usingCapacitor = true
              setInset(info.keyboardHeight)
            }),
          )
          handles.push(
            await Keyboard.addListener('keyboardWillHide', () => {
              clear()
            }),
          )
          handles.push(
            await Keyboard.addListener('keyboardDidHide', () => {
              clear()
            }),
          )
          if (cancelled) {
            handles.forEach((h) => void h.remove())
            return
          }
          removeCap = () => {
            handles.forEach((h) => void h.remove())
          }
        } catch {
          /* web / plugin unavailable */
        }
      })()
    }

    const syncViewport = () => {
      if (usingCapacitor) return
      const vv = window.visualViewport
      if (!vv) return
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setInset(covered)
    }

    window.visualViewport?.addEventListener('resize', syncViewport)
    window.visualViewport?.addEventListener('scroll', syncViewport)
    window.addEventListener('focusin', syncViewport)

    return () => {
      cancelled = true
      removeCap?.()
      window.visualViewport?.removeEventListener('resize', syncViewport)
      window.visualViewport?.removeEventListener('scroll', syncViewport)
      window.removeEventListener('focusin', syncViewport)
      clear()
    }
  }, [enabled])
}

/** Scroll the focused field into view inside its nearest scroll parent (iOS-safe). */
export function scrollFieldAboveKeyboard(el: HTMLElement | null) {
  if (!el) return
  window.requestAnimationFrame(() => {
    const keyboard = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset') || '0',
    )
    const pad = Math.max(keyboard, 0) + 24
    const rect = el.getBoundingClientRect()
    const limit = window.innerHeight - pad
    if (rect.bottom <= limit && rect.top >= 0) return

    let parent: HTMLElement | null = el.parentElement
    while (parent) {
      const style = getComputedStyle(parent)
      const canScroll =
        /(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight
      if (canScroll) {
        const parentRect = parent.getBoundingClientRect()
        const delta = rect.bottom - Math.min(limit, parentRect.bottom - 12)
        if (delta > 0) parent.scrollTop += delta
        else if (rect.top < parentRect.top + 12) parent.scrollTop -= parentRect.top + 12 - rect.top
        return
      }
      parent = parent.parentElement
    }

    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  })
}
