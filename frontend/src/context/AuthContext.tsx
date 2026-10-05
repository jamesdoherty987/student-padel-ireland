import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { apiErrorStatus, authApi, type User } from '../services/api'
import {
  clearAuthStorage,
  getAuthToken,
  getStoredUser,
  updateStoredUser,
  writeAuth,
} from '../utils/authStorage'

type AuthState = {
  user: User | null
  token: string | null
  loading: boolean
  login: (email: string, password: string, remember?: boolean) => Promise<User>
  register: (data: Record<string, unknown>, remember?: boolean) => Promise<User>
  logout: () => void
  /** Patch fields on the in-memory + stored user (e.g. after profile name edit). */
  patchUser: (patch: Partial<User>) => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getAuthToken())
  const [user, setUser] = useState<User | null>(() => (getAuthToken() ? getStoredUser() : null))
  // Only block UI when we have a token but no cached profile yet
  const [loading, setLoading] = useState(() => !!getAuthToken() && !getStoredUser())

  useEffect(() => {
    const onSoftLogout = () => {
      setToken(null)
      setUser(null)
      setLoading(false)
    }
    window.addEventListener('isp:logout', onSoftLogout)
    return () => window.removeEventListener('isp:logout', onSoftLogout)
  }, [])

  useEffect(() => {
    if (!token) return

    let cancelled = false
    if (!getStoredUser()) setLoading(true)

    authApi
      .me()
      .then((res) => {
        if (cancelled) return
        setUser(res.data)
        updateStoredUser(res.data)
      })
      .catch((err) => {
        if (cancelled) return
        // Only drop the session on hard auth failures - keep cached user on network/5xx blips
        const status = apiErrorStatus(err)
        if (status === 401 || status === 403) {
          clearAuthStorage()
          setToken(null)
          setUser(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const persist = (accessToken: string, nextUser: User, remember = true) => {
    writeAuth(accessToken, nextUser, remember)
    setToken(accessToken)
    setUser(nextUser)
    setLoading(false)
  }

  // Guards against a non-JSON reply (e.g. a hosting "waking up" page) that would otherwise crash
  const readSession = (data: unknown): { access_token: string; user: User } => {
    const d = data as { access_token?: string; user?: User } | null
    if (!d || typeof d !== 'object' || !d.access_token || !d.user) {
      throw new Error('The server is starting up. Please try again in a few seconds.')
    }
    return { access_token: d.access_token, user: d.user }
  }

  const login = async (email: string, password: string, remember = true) => {
    const { data } = await authApi.login({ email, password })
    const session = readSession(data)
    persist(session.access_token, session.user, remember)
    return session.user
  }

  const register = async (payload: Record<string, unknown>, remember = true) => {
    const { data } = await authApi.register(payload)
    const session = readSession(data)
    persist(session.access_token, session.user, remember)
    return session.user
  }

  const logout = () => {
    clearAuthStorage()
    setToken(null)
    setUser(null)
    setLoading(false)
  }

  const patchUser = (patch: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      updateStoredUser(next)
      return next
    })
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, patchUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
