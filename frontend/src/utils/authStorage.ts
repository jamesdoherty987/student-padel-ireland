/** Browser auth persistence - keep signed in across visits when Remember me is on. */

export type StoredAuthUser = {
  id: string
  email: string
  full_name: string
  phone?: string | null
  role: string
  university_id?: string | null
  student_number?: string | null
  is_active: boolean
}

const TOKEN_KEY = 'isp_token'
const USER_KEY = 'isp_user'
const STORE_KEY = 'isp_auth_store' // 'local' | 'session'

function safeParseUser(raw: string | null): StoredAuthUser | null {
  if (!raw) return null
  try {
    const u = JSON.parse(raw) as StoredAuthUser
    if (u && typeof u.id === 'string' && typeof u.email === 'string') return u
  } catch {
    /* ignore */
  }
  return null
}

export function readAuthStoreMode(): 'local' | 'session' {
  try {
    const mode = localStorage.getItem(STORE_KEY)
    if (mode === 'session') return 'session'
  } catch {
    /* ignore */
  }
  return 'local'
}

function authStorage(mode: 'local' | 'session' = readAuthStoreMode()): Storage {
  try {
    return mode === 'session' ? sessionStorage : localStorage
  } catch {
    return localStorage
  }
}

export function getAuthToken(): string | null {
  try {
    const mode = readAuthStoreMode()
    const primary = authStorage(mode).getItem(TOKEN_KEY)
    if (primary) return primary
    // Migrate legacy tokens that lived only in localStorage
    const legacy = localStorage.getItem(TOKEN_KEY)
    if (legacy) return legacy
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getStoredUser(): StoredAuthUser | null {
  try {
    const mode = readAuthStoreMode()
    const primary = safeParseUser(authStorage(mode).getItem(USER_KEY))
    if (primary) return primary
    return safeParseUser(localStorage.getItem(USER_KEY)) || safeParseUser(sessionStorage.getItem(USER_KEY))
  } catch {
    return null
  }
}

export function clearAuthStorage() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(STORE_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}

export function writeAuth(accessToken: string, user: StoredAuthUser, remember: boolean) {
  clearAuthStorage()
  const mode = remember ? 'local' : 'session'
  try {
    localStorage.setItem(STORE_KEY, mode)
    const store = authStorage(mode)
    store.setItem(TOKEN_KEY, accessToken)
    store.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    /* ignore quota / private mode */
  }
}

export function updateStoredUser(user: StoredAuthUser) {
  try {
    authStorage().setItem(USER_KEY, JSON.stringify(user))
  } catch {
    /* ignore */
  }
}
