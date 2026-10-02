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

  const login = async (email: string, password: string, remember = true) => {
    const { data } = await authApi.login({ email, password })
    persist(data.access_token, data.user, remember)
    return data.user as User
  }

  const register = async (payload: Record<string, unknown>, remember = true) => {
    const { data } = await authApi.register(payload)
    persist(data.access_token, data.user, remember)
    return data.user as User
  }

  const logout = () => {
    clearAuthStorage()
    setToken(null)
    setUser(null)
    setLoading(false)
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
