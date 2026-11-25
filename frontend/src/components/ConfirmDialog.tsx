import { useEffect, useState } from 'react'

type ConfirmDialogState = {
  isOpen: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  danger: boolean
  generation: number
  onConfirm: () => void
  onCancel: () => void
  isLoading: boolean
}

const initialState: ConfirmDialogState = {
  isOpen: false,
  title: '',
  message: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  danger: false,
  generation: 0,
  onConfirm: () => {},
  onCancel: () => {},
  isLoading: false,
}

let dialogState = { ...initialState }
let dialogGeneration = 0
const listeners = new Set<() => void>()

const notify = () => {
  listeners.forEach((listener) => listener())
}

type ConfirmResolve = (value: boolean | null) => void
let resolveOpen: ConfirmResolve | null = null

/** True while a confirm is visible — soft prompts should wait instead of stealing. */
export function isConfirmDialogOpen(): boolean {
  return dialogState.isOpen
}

/**
 * Returns true (confirm), false (cancel / Escape / backdrop), or null when
 * another confirm steals focus (interrupted — not a user dismiss).
 */
export const confirmDialog = ({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
}: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}): Promise<boolean | null> => {
  return new Promise((resolve) => {
    // Interrupt any open dialog so callers never hang — null ≠ Later/Cancel
    if (dialogState.isOpen && resolveOpen) {
      const prev = resolveOpen
      resolveOpen = null
      prev(null)
    }

    const generation = ++dialogGeneration
    resolveOpen = resolve
    dialogState = {
      isOpen: true,
      title,
      message,
      confirmLabel,
      cancelLabel,
      danger,
      generation,
      isLoading: false,
      onConfirm: () => {
        if (generation !== dialogGeneration) return
        resolveOpen = null
        resolve(true)
      },
      onCancel: () => {
        if (generation !== dialogGeneration) return
        resolveOpen = null
        resolve(false)
      },
    }
    notify()
  })
}

export function ConfirmDialogProvider() {
  const [state, setState] = useState(dialogState)

  useEffect(() => {
    const sync = () => setState({ ...dialogState })
    listeners.add(sync)
    // Pick up a dialog opened before this provider subscribed
    sync()
    return () => {
      listeners.delete(sync)
    }
  }, [])

  useEffect(() => {
    if (!state.isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.body.classList.add('modal-open')
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || dialogState.isLoading) return
      if (!dialogState.isOpen || dialogState.generation !== dialogGeneration) return
      e.stopImmediatePropagation()
      dialogState.onCancel()
      dialogState = { ...initialState, generation: dialogGeneration }
      notify()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.body.style.overflow = prev
      document.body.classList.remove('modal-open')
      window.removeEventListener('keydown', onKey, true)
    }
  }, [state.isOpen, state.generation])

  if (!state.isOpen) return null

  const closeWith = (fn: () => void) => {
    // Ignore stale clicks from an interrupted previous dialog render
    if (state.generation !== dialogGeneration) return
    fn()
    dialogState = { ...initialState, generation: dialogGeneration }
    notify()
  }

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onClick={() => {
        if (!state.isLoading) closeWith(state.onCancel)
      }}
      role="presentation"
    >
      <div
        className="modal confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title">{state.title}</h2>
        <p id="confirm-dialog-message">{state.message}</p>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => closeWith(state.onCancel)}
            disabled={state.isLoading}
            autoFocus={state.danger}
          >
            {state.cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => closeWith(state.onConfirm)}
            disabled={state.isLoading}
            autoFocus={!state.danger}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
