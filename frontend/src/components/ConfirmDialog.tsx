import { useEffect, useState } from 'react'

type ConfirmDialogState = {
  isOpen: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  danger: boolean
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
  onConfirm: () => {},
  onCancel: () => {},
  isLoading: false,
}

let dialogState = { ...initialState }
const listeners = new Set<() => void>()

const notify = () => {
  listeners.forEach((listener) => listener())
}

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
}): Promise<boolean> => {
  return new Promise((resolve) => {
    // Resolve any open dialog so callers never hang if a second confirm opens
    if (dialogState.isOpen) {
      dialogState.onCancel()
    }
    dialogState = {
      isOpen: true,
      title,
      message,
      confirmLabel,
      cancelLabel,
      danger,
      isLoading: false,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    }
    notify()
  })
}

export function ConfirmDialogProvider() {
  const [state, setState] = useState(dialogState)

  useEffect(() => {
    const sync = () => setState({ ...dialogState })
    listeners.add(sync)
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
      if (e.key === 'Escape' && !dialogState.isLoading) {
        dialogState.onCancel()
        dialogState = { ...initialState }
        notify()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.body.classList.remove('modal-open')
      window.removeEventListener('keydown', onKey)
    }
  }, [state.isOpen])

  if (!state.isOpen) return null

  const closeWith = (fn: () => void) => {
    fn()
    dialogState = { ...initialState }
    notify()
  }

  return (
    <div
      className="modal-backdrop"
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
          >
            {state.cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => closeWith(state.onConfirm)}
            disabled={state.isLoading}
            autoFocus
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
