import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import BrandLogo from '../components/BrandLogo'
import { useAuth } from '../context/AuthContext'
import { isNativeApp } from '../native/platform'
import { setStatusBarForDarkScreen, setStatusBarForLightScreen } from '../native/statusBar'
import { apiErrorMessage, platformApi } from '../services/api'
import { safeNextPath } from '../utils/navigation'
import './Auth.css'

function useDarkStatusBar() {
  useEffect(() => {
    void setStatusBarForDarkScreen()
    return () => {
      void setStatusBarForLightScreen()
    }
  }, [])
}

function homeForRole(role: string) {
  return role === 'ADMIN' ? '/admin' : '/tournaments'
}

export function LoginPage() {
  useDarkStatusBar()
  const { login, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (authLoading) {
    return (
      <div className="auth-page">
        <div className="auth-panel">
          <div className="skeleton" style={{ height: 28, width: '55%', marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 120 }} />
        </div>
      </div>
    )
  }

  if (user) {
    return <Navigate to={next || homeForRole(user.role)} replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const u = await login(email, password, remember)
      navigate(next || homeForRole(u.role))
    } catch (err) {
      setError(apiErrorMessage(err, 'Invalid email or password'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <BrandLogo to={isNativeApp() ? '/welcome' : '/'} className="auth-brand" size="md" />
        <h1>Welcome back</h1>
        <p className="auth-lead">Log in to join tournaments and see your next match.</p>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="form-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <label className="auth-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Stay signed in</span>
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Signing in...' : 'Log in'}
          </button>
        </form>
        <p className="auth-foot">
          No account?{' '}
          <Link to={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}>Sign up</Link>
        </p>
        {import.meta.env.DEV && (
          <p className="auth-demo">
            Dev: james@ul.ie / player12345 · organiser@studentpadelireland.ie / organiser123 ·
            admin@studentpadelireland.ie / admin12345
          </p>
        )}
      </div>
    </div>
  )
}

export function SignupPage() {
  useDarkStatusBar()
  const { register, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const { data: universities = [] } = useQuery({
    queryKey: ['universities'],
    queryFn: async () => (await platformApi.universities()).data,
  })

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    phone: '',
    university_id: '',
    student_number: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (authLoading) {
    return (
      <div className="auth-page">
        <div className="auth-panel">
          <div className="skeleton" style={{ height: 28, width: '55%', marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 160 }} />
        </div>
      </div>
    )
  }

  if (user) {
    return <Navigate to={next || homeForRole(user.role)} replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const u = await register({
        ...form,
        university_id: form.university_id || null,
        phone: form.phone || null,
        student_number: form.student_number || null,
      })
      navigate(next || homeForRole(u.role))
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create account'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <BrandLogo to={isNativeApp() ? '/welcome' : '/'} className="auth-brand" size="md" />
        <h1>Create account</h1>
        <p className="auth-lead">
          Sign up to play, join events, and host tournaments from My events.
        </p>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="signup-name">
              Full name
            </label>
            <input
              id="signup-name"
              className="form-input"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
              minLength={2}
              autoComplete="name"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="signup-email">
              Email
            </label>
            <input
              id="signup-email"
              className="form-input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="signup-password">
              Password (min 8 characters)
            </label>
            <input
              id="signup-password"
              className="form-input"
              type="password"
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              autoComplete="new-password"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="signup-uni">
              University
            </label>
            <select
              id="signup-uni"
              className="form-select"
              value={form.university_id}
              onChange={(e) => setForm({ ...form, university_id: e.target.value })}
            >
              <option value="">Select university</option>
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="signup-phone">
              Phone (optional)
            </label>
            <input
              id="signup-phone"
              className="form-input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              autoComplete="tel"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="signup-student">
              Student number (optional)
            </label>
            <input
              id="signup-student"
              className="form-input"
              value={form.student_number}
              onChange={(e) => setForm({ ...form, student_number: e.target.value })}
            />
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Creating...' : 'Sign up'}
          </button>
        </form>
        <p className="auth-foot">
          Already have an account?{' '}
          <Link to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}>Log in</Link>
        </p>
      </div>
    </div>
  )
}
