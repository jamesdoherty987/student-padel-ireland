/** Normalize FastAPI / Axios error payloads into a readable string. */
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong') {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'msg' in item) return String((item as { msg: string }).msg)
        return null
      })
      .filter(Boolean)
      .join('. ') || fallback
  }
  if (detail && typeof detail === 'object' && 'msg' in detail) {
    return String((detail as { msg: string }).msg)
  }
  const message = (err as { message?: string })?.message
  if (message && message !== 'Network Error') return message
  if (message === 'Network Error') return 'Cannot reach the server. Is the API running?'
  return fallback
}
