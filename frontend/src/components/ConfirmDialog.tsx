import { useState, useCallback } from 'react'

type ConfirmDialogState = {
  isOpen: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  isLoading: boolean
}

const initialState: ConfirmDialogState = {
  isOpen: false,
  title: '',
  message: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  onConfirm: () => {},
  onCancel: () => {},
  isLoading: false,
}

let dialogState = { ...initialState }
let listeners: Set<() => void> = new Set()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const notify = () => {
  listeners.forEach((listener) => listener())
}

export const confirmDialog = async ({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
}: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
}): Promise<boolean> => {
  return new Promise((resolve) => {
    dialogState = {
      isOpen: true,
      title,
      message,
      confirmLabel,
      cancelLabel,
      isLoading: false,
      onConfirm: () => {
        resolve(true)
      },
      onCancel: () => {
        resolve(false)
      },
    }
    notify()
  })
}

export function ConfirmDialogProvider() {
  const [state, setState] = useState(dialogState)

  const unsubscribe = useCallback(() => {
    return subscribe(() => {
      setState({ ...dialogState })
    })
  }, [])

  // Subscribe on mount
  unsubscribe()

  const handleConfirm = async () => {
    setState((s) => ({ ...s, isLoading: true }))
    dialogState.isLoading = true
    try {
      await state.onConfirm()
    } finally {
      setState((s) => ({ ...s, isOpen: false, isLoading: false }))
      dialogState = { ...initialState }
    }
  }

  const handleCancel = () => {
    state.onCancel()
    setState((s) => ({ ...s, isOpen: false }))
    dialogState = { ...initialState }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !state.isLoading) {
      handleCancel()
    }
  }

  if (!state.isOpen) return null

  return (
    <div className="modal-backdrop" onClick={handleCancel} onKeyDown={handleKeyDown} role="presentation">
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title">{state.title}</h2>
        <p>{state.message}</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={handleCancel} disabled={state.isLoading}>
            {state.cancelLabel}
          </button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={state.isLoading}>
            {state.isLoading ? 'Please wait…' : state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
