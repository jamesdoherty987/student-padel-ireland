import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  /** Used when the field is left empty on blur */
  emptyValue?: number
}

/**
 * Number field that can be cleared while typing (no snap-back to defaults mid-edit).
 * Keeps partial input (e.g. "10." or "") until blur/Enter, then clamps.
 */
export default function NumberInput({
  value,
  onValueChange,
  min,
  max,
  emptyValue,
  onBlur,
  onKeyDown,
  onFocus,
  ...rest
}: Props) {
  const [text, setText] = useState(() => String(value))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setText(String(value))
  }, [value])

  const clamp = (n: number) => {
    let next = n
    if (min != null && Number.isFinite(min)) next = Math.max(min, next)
    if (max != null && Number.isFinite(max)) next = Math.min(max, next)
    return next
  }

  const commit = (raw: string) => {
    const fallback = emptyValue ?? min ?? value
    if (raw.trim() === '' || raw.trim() === '.' || raw.trim() === '-') {
      const next = clamp(fallback)
      onValueChange(next)
      setText(String(next))
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) {
      setText(String(value))
      return
    }
    const next = clamp(n)
    onValueChange(next)
    setText(String(next))
  }

  return (
    <input
      {...rest}
      type="number"
      value={text}
      onFocus={(e) => {
        focused.current = true
        onFocus?.(e)
      }}
      onChange={(e) => {
        setText(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(text)
        onKeyDown?.(e)
      }}
      onBlur={(e) => {
        focused.current = false
        commit(text)
        onBlur?.(e)
      }}
    />
  )
}
