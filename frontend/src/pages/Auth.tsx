import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import BrandLogo from '../components/BrandLogo'
import SearchableSelect from '../components/SearchableSelect'
import { universitySelectOptions } from '../utils/universities'
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
      : next.includes('create=1') || next.startsWith('/admin') || next.startsWith('/manage')
        ? 'Log in with an admin account to manage events.'
        : next.includes('filter=mine')
          ? 'Log in with an admin account to see events you manage.'
          : next.includes('/rankings')
            ? 'Log in to filter rankings by your events, friends, or university.'
            : next.includes('/community')
              ? 'Log in to add friends and join with a code.'
              : 'Log in to join tournaments and manage your entries.'

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
            Dev: james@ul.ie / player12345 · admin from ADMIN_EMAIL / ADMIN_PASSWORD
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
  // Partner-invite emails prefill ?email=&name= so they claim the stub already on the team
  const inviteEmail = (params.get('email') || '').trim().toLowerCase()
  const inviteName = (params.get('name') || '').trim()
  const emailFromInvite = inviteEmail.includes('@')
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
    full_name: inviteName,
    email: emailFromInvite ? inviteEmail : '',
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
          // Never let a partner-invite claim use a different email than the stub on the team
          email: emailFromInvite ? inviteEmail : form.email,
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
          {emailFromInvite
            ? 'Your teammate already added you - finish signup with this email to see your team.'
            : next.includes('/join')
              ? 'Create an account to finish joining with your invite.'
              : next.includes('/confirmed') || next.includes('/live')
                ? 'Create an account to continue to your match.'
                : next.includes('create=1') || next.startsWith('/admin') || next.startsWith('/manage')
                  ? 'Admin accounts are provisioned separately — create a player account to join events.'
                  : next.includes('/community')
                    ? 'Create an account to add friends and join events.'
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
              readOnly={emailFromInvite}
              autoComplete="email"
              inputMode="email"
              enterKeyHint="next"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={emailFromInvite ? 'signup-email-hint' : undefined}
            />
            {emailFromInvite && (
              <p id="signup-email-hint" className="auth-field-hint">
                Locked to the invite email so you stay on your teammate’s entry
              </p>
            )}
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
                    : 'Search or choose your university'
              }
              searchPlaceholder="Type the university name…"
              emptyLabel="No university matches that name"
              required
              disabled={unisLoading || unisError || universities.length === 0}
              options={universitySelectOptions(universities)}
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
