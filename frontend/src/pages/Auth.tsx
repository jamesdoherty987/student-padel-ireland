import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import BrandLogo from '../components/BrandLogo'
import SearchableSelect from '../components/SearchableSelect'
import { useAuth } from '../context/AuthContext'
import { scrollFieldAboveKeyboard, useKeyboardInset } from '../hooks/useKeyboardInset'
import { usePageSeo } from '../hooks/usePageSeo'
import { isNativeApp } from '../native/platform'
import { setStatusBarForDarkScreen, setStatusBarForLightScreen } from '../native/statusBar'
import { apiErrorMessage, platformApi } from '../services/api'
import { appHomePath, homeForRole, safeNextPath } from '../utils/navigation'
import './Auth.css'

function useDarkStatusBar() {
  useEffect(() => {
    void setStatusBarForDarkScreen()
    return () => {
      void setStatusBarForLightScreen()
    }
  }, [])
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  required,
  enterKeyHint,
  hint,
  invalid,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  minLength?: number
  required?: boolean
  enterKeyHint?: 'done' | 'go' | 'next'
  hint?: string
  invalid?: boolean
}) {
  const [visible, setVisible] = useState(false)
  const hintId = `${id}-hint`
  const meetsMin = !minLength || value.length >= minLength

  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <div className="auth-password">
        <input
          id={id}
          className="form-input"
          type={visible ? 'text' : 'password'}
          name={id.includes('login') ? 'password' : 'new-password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          enterKeyHint={enterKeyHint}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? hintId : undefined}
        />
        <button
          type="button"
          className="auth-password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && (
        <p
          id={hintId}
          className={`auth-field-hint ${value.length > 0 && meetsMin ? 'is-ok' : ''}`}
        >
          {hint}
        </p>
      )}
    </div>
  )
}

export function LoginPage() {
  useDarkStatusBar()
  useKeyboardInset(true)
  usePageSeo({
    title: 'Log in',
    description: 'Log in to Student Padel Ireland to join tournaments and track your matches.',
    path: '/login',
    noIndex: true,
  })
  const { login, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const native = isNativeApp()

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (!t.closest('.auth-page')) return
      if (t.matches('input, textarea, select, [contenteditable]')) {
        scrollFieldAboveKeyboard(t)
      }
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])
  const lead = next.includes('/confirmed')
    ? 'Log in with the account used at checkout to confirm your registration.'
    : next.includes('/join')
      ? 'Log in to finish joining.'
      : next.includes('create=1')
        ? 'Log in to create your tournament.'
        : next.includes('filter=mine')
          ? 'Log in to see tournaments you own.'
          : next.startsWith('/organiser')
            ? 'Log in to manage your event.'
            : next.includes('/rankings')
              ? 'Log in to filter rankings by your events, friends, or university.'
              : next.includes('/community')
                ? 'Log in to play with friends.'
                : 'Log in to join tournaments and see your next match.'

  if (authLoading) {
    return (
      <div className={`auth-page${native ? ' auth-page--native' : ''}`}>
        <div className="auth-panel" aria-busy="true">
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
    <div className={`auth-page${native ? ' auth-page--native' : ''}`}>
      <div className="auth-panel">
        <BrandLogo to={native ? null : appHomePath()} className="auth-brand" size="md" />
        <h1>Welcome back</h1>
        <p className="auth-lead">{lead}</p>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="form-input"
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              inputMode="email"
              enterKeyHint="next"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
            />
          </div>
          <PasswordField
            id="login-password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
            enterKeyHint="go"
            invalid={Boolean(error)}
          />
          <label className="auth-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Stay signed in</span>
          </label>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary btn-block auth-submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Log in'}
          </button>
        </form>
        <p className="auth-foot">
          No account?{' '}
          <Link to={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}>Sign up</Link>
        </p>
        {native && (
          <p className="auth-foot auth-foot--browse">
            <Link to="/tournaments">Browse tournaments without an account</Link>
          </p>
        )}
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
  useKeyboardInset(true)
  usePageSeo({
    title: 'Sign up',
    description: 'Create a Student Padel Ireland account to join student padel tournaments across Ireland.',
    path: '/signup',
    noIndex: true,
  })
  const { register, user, loading: authLoading } = useAuth()

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (!t.closest('.auth-page')) return
      if (t.matches('input, textarea, select, [contenteditable]')) {
        scrollFieldAboveKeyboard(t)
      }
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const {
    data: universities = [],
    isLoading: unisLoading,
    isError: unisError,
    refetch: refetchUnis,
  } = useQuery({
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
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const native = isNativeApp()

  if (authLoading) {
    return (
      <div className={`auth-page${native ? ' auth-page--native' : ''}`}>
        <div className="auth-panel" aria-busy="true">
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
      const u = await register(
        {
          ...form,
          university_id: form.university_id || null,
          phone: form.phone || null,
          student_number: form.student_number || null,
        },
        remember,
      )
      navigate(next || homeForRole(u.role))
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create account'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`auth-page${native ? ' auth-page--native' : ''}`}>
      <div className="auth-panel">
        <BrandLogo to={native ? null : appHomePath()} className="auth-brand" size="md" />
        <h1>Create your account</h1>
        <p className="auth-lead">
          {next.includes('/join')
            ? 'Create an account to finish joining with your invite.'
            : next.includes('/confirmed') || next.includes('/live')
              ? 'Create an account to continue to your match.'
              : next.includes('create=1')
                ? 'Create an account to set up your tournament.'
                : next.startsWith('/organiser')
                  ? 'Create an account to manage your event.'
                  : next.includes('/community')
                    ? 'Create an account to play with friends.'
                    : 'A few details and you’re ready to play and join events.'}
        </p>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="signup-name">
              Full name
            </label>
            <input
              id="signup-name"
              className="form-input"
              name="name"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
              minLength={2}
              autoComplete="name"
              enterKeyHint="next"
              autoCapitalize="words"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Your name"
              aria-invalid={error ? true : undefined}
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
              name="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              autoComplete="email"
              inputMode="email"
              enterKeyHint="next"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <PasswordField
            id="signup-password"
            label="Password"
            value={form.password}
            onChange={(password) => setForm({ ...form, password })}
            autoComplete="new-password"
            minLength={8}
            required
            enterKeyHint="next"
            hint="At least 8 characters"
          />
          <div className="form-group">
            <label className="form-label" htmlFor="signup-uni">
              University
            </label>
            <SearchableSelect
              id="signup-uni"
              value={form.university_id}
              onChange={(university_id) => setForm({ ...form, university_id })}
              placeholder={
                unisLoading
                  ? 'Loading universities…'
                  : unisError
                    ? 'Couldn’t load universities'
                    : 'Search your university'
              }
              searchPlaceholder="Type to search…"
              emptyLabel="No university matches that name"
              required
              disabled={unisLoading || unisError || universities.length === 0}
              options={universities.map((u) => ({
                value: u.id,
                label: u.name,
                keywords: u.short_name || '',
              }))}
            />
            {unisError ? (
              <p className="auth-field-hint" role="alert">
                Couldn’t load universities.{' '}
                <button type="button" className="auth-inline-retry" onClick={() => void refetchUnis()}>
                  Retry
                </button>
              </p>
            ) : (
              <p className="auth-field-hint">Used for rankings and campus events</p>
            )}
          </div>
          <details className="auth-more">
            <summary>
              <span>Optional details</span>
              <span className="auth-more-meta">Phone · student number</span>
            </summary>
            <div className="auth-more-body">
              <div className="form-group">
                <label className="form-label" htmlFor="signup-phone">
                  Phone
                </label>
                <input
                  id="signup-phone"
                  className="form-input"
                  type="tel"
                  name="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  autoComplete="tel"
                  inputMode="tel"
                  enterKeyHint="next"
                  placeholder="Optional"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="signup-student">
                  Student number
                </label>
                <input
                  id="signup-student"
                  className="form-input"
                  name="student-number"
                  value={form.student_number}
                  onChange={(e) => setForm({ ...form, student_number: e.target.value })}
                  autoComplete="off"
                  enterKeyHint="done"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Optional"
                />
              </div>
            </div>
          </details>
          <label className="auth-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Stay signed in</span>
          </label>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="btn btn-primary btn-block auth-submit"
            disabled={loading || unisLoading || unisError || universities.length === 0}
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="auth-foot">
          Already have an account?{' '}
          <Link to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}>Log in</Link>
        </p>
        {native && (
          <p className="auth-foot auth-foot--browse">
            <Link to="/tournaments">Browse tournaments without an account</Link>
          </p>
        )}
      </div>
    </div>
  )
}
