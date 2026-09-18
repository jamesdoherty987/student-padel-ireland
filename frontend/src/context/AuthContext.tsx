import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { authApi, type User } from '../services/api'

type AuthState = {
  user: User | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  register: (data: Record<string, unknown>) => Promise<User>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('isp_token'))
  const [loading, setLoading] = useState(true)

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
    if (!token) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    authApi
      .me()
      .then((res) => {
        if (!cancelled) setUser(res.data)
      })
      .catch(() => {
        if (cancelled) return
        localStorage.removeItem('isp_token')
        localStorage.removeItem('isp_user')
        setToken(null)
        setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const persist = (accessToken: string, nextUser: User) => {
    localStorage.setItem('isp_token', accessToken)
    localStorage.setItem('isp_user', JSON.stringify(nextUser))
    setToken(accessToken)
    setUser(nextUser)
  }

  const login = async (email: string, password: string) => {
    const { data } = await authApi.login({ email, password })
    persist(data.access_token, data.user)
    return data.user as User
  }

  const register = async (payload: Record<string, unknown>) => {
    const { data } = await authApi.register(payload)
    persist(data.access_token, data.user)
    return data.user as User
  }

  const logout = () => {
    localStorage.removeItem('isp_token')
    localStorage.removeItem('isp_user')
    setToken(null)
    setUser(null)
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
