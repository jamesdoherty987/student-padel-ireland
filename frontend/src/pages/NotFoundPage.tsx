import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'

export default function NotFoundPage() {
  return (
    <div className="app-shell">
      <NavBar />
      <main className="page empty-state" style={{ paddingTop: '4rem' }}>
        <p className="eyebrow" style={{ marginBottom: '0.75rem' }}>
          404
        </p>
        <h1 className="page-title">Page not found</h1>
        <p className="page-sub">That link doesn&apos;t match a tournament or page.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/" className="btn btn-primary">
            Home
          </Link>
          <Link to="/tournaments" className="btn btn-ghost">
            Tournaments
          </Link>
        </div>
      </main>
    </div>
  )
}
