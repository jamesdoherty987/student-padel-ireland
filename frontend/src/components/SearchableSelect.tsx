import { useEffect, useId, useMemo, useRef, useState } from 'react'

export type SearchableOption = {
  value: string
  label: string
  /** Extra text matched by search (e.g. short university code) */
  keywords?: string
}

type Props = {
  id?: string
  value: string
  options: SearchableOption[]
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyLabel?: string
  required?: boolean
  disabled?: boolean
  /** Accessible name when no visible label is associated */
  'aria-label'?: string
  'aria-labelledby'?: string
  className?: string
}

function matchesQuery(opt: SearchableOption, q: string) {
  if (!q) return true
  const hay = `${opt.label} ${opt.keywords || ''}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => hay.includes(part))
}

/**
 * Searchable single-select for long lists (universities, partners, etc.).
 * Type to filter; pick from the list. Works well on mobile.
 */
export default function SearchableSelect({
  id,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search by name…',
  emptyLabel = 'No matches',
  required,
  disabled,
  className = '',
  ...aria
}: Props) {
  const listId = useId()
  const inputId = useId()
  const autoTriggerId = useId()
  const triggerId = id || autoTriggerId
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  const selected = options.find((o) => o.value === value) || null
  const orphanValue = Boolean(value && !selected)
  // Required but unknown id must fail native validation
  const formValue = orphanValue ? '' : value

  const filtered = useMemo(() => {
    const q = query.trim()
    const list = options.filter((o) => matchesQuery(o, q))
    if (!q && selected) {
      return [selected, ...list.filter((o) => o.value !== selected.value)]
    }
    return list
  }, [options, query, selected])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    setHighlight(0)
  }, [query, open])

  const pick = (next: string) => {
    onChange(next)
    setOpen(false)
    setQuery('')
  }

  const clear = () => {
    onChange('')
    setQuery('')
    setOpen(true)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  const displayLabel = selected
    ? selected.label
    : orphanValue
      ? 'Please re-select…'
      : placeholder

  return (
    <div
      ref={rootRef}
      className={`searchable-select ${open ? 'is-open' : ''} ${orphanValue ? 'is-orphan' : ''} ${className}`.trim()}
    >
      {required && (
        <input
          tabIndex={-1}
          aria-hidden
          required
          value={formValue}
          onChange={() => {}}
          style={{
            position: 'absolute',
            opacity: 0,
            width: 1,
            height: 1,
            pointerEvents: 'none',
          }}
        />
      )}

      {!open ? (
        <button
          type="button"
          id={triggerId}
          className={`searchable-select-trigger form-input ${!selected ? 'is-placeholder' : ''}`}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={false}
          aria-labelledby={aria['aria-labelledby']}
          aria-label={aria['aria-label']}
          onClick={() => {
            if (disabled) return
            setOpen(true)
            window.setTimeout(() => inputRef.current?.focus(), 0)
          }}
        >
          <span className="searchable-select-value">{displayLabel}</span>
          <span className="searchable-select-chevron" aria-hidden>
            ▾
          </span>
        </button>
      ) : (
        <div className="searchable-select-panel">
          <div className="searchable-select-search-row">
            <input
              ref={inputRef}
              id={inputId}
              className="form-input searchable-select-input"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                filtered[highlight] ? `${listId}-opt-${filtered[highlight].value}` : undefined
              }
              aria-labelledby={aria['aria-labelledby']}
              aria-label={aria['aria-label'] || searchPlaceholder}
              value={query}
              disabled={disabled}
              placeholder={searchPlaceholder}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHighlight((h) => Math.max(h - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  const opt = filtered[highlight]
                  if (opt) pick(opt.value)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setOpen(false)
                  setQuery('')
                }
              }}
            />
            {value && (
              <button type="button" className="searchable-select-clear" onClick={clear}>
                Clear
              </button>
            )}
          </div>
          <ul id={listId} className="searchable-select-list" role="listbox">
            {filtered.length === 0 ? (
              <li className="searchable-select-empty">{emptyLabel}</li>
            ) : (
              filtered.map((opt, i) => (
                <li key={opt.value} role="presentation">
                  <button
                    type="button"
                    id={`${listId}-opt-${opt.value}`}
                    role="option"
                    aria-selected={opt.value === value}
                    className={`searchable-select-option ${opt.value === value ? 'is-selected' : ''} ${
                      i === highlight ? 'is-active' : ''
                    }`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(opt.value)}
                  >
                    {opt.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
