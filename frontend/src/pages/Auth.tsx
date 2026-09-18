import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { apiErrorMessage, platformApi } from '../services/api'
import { safeNextPath } from '../utils/navigation'
import './Auth.css'

export function LoginPage() {
  const { login, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    const dest =
      next ||
      (user.role === 'ORGANISER' || user.role === 'ADMIN' ? '/organiser' : '/tournaments')
    return <Navigate to={dest} replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const u = await login(email, password)
      if (next) navigate(next)
      else if (u.role === 'ORGANISER' || u.role === 'ADMIN') navigate('/organiser')
      else navigate('/tournaments')
    } catch (err) {
      setError(apiErrorMessage(err, 'Invalid email or password'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <Link to="/" className="auth-brand">
          Student Padel Ireland
        </Link>
        <h1>Welcome back</h1>
        <p className="auth-lead">Log in to join tournaments and see your next match.</p>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Signing in…' : 'Log in'}
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
  const { register, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const defaultRole = params.get('role') === 'ORGANISER' ? 'ORGANISER' : 'PLAYER'
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
    role: defaultRole,
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
    const dest =
      next ||
      (user.role === 'ORGANISER' || user.role === 'ADMIN' ? '/organiser' : '/tournaments')
    return <Navigate to={dest} replace />
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
      if (next) navigate(next)
      else navigate(u.role === 'ORGANISER' ? '/organiser' : '/tournaments')
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create account'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <Link to="/" className="auth-brand">
          Student Padel Ireland
        </Link>
        <h1>Create account</h1>
        <p className="auth-lead">Player or organiser — start in under a minute.</p>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label">I am a</label>
            <select
              className="form-select"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="PLAYER">Player</option>
              <option value="ORGANISER">Tournament organiser</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Full name</label>
            <input
              className="form-input"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
              minLength={2}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password (min 8 characters)</label>
            <input
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
            <label className="form-label">University</label>
            <select
              className="form-select"
              value={form.university_id}
              onChange={(e) => setForm({ ...form, university_id: e.target.value })}
            >
              <option value="">Select…</option>
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Phone (optional)</label>
            <input
              className="form-input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Student number (optional)</label>
            <input
              className="form-input"
              value={form.student_number}
              onChange={(e) => setForm({ ...form, student_number: e.target.value })}
            />
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Creating…' : 'Sign up'}
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
