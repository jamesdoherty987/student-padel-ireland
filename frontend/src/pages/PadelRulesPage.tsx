import { useState } from 'react'
import { Link } from 'react-router-dom'
import BackButton from '../components/BackButton'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { usePageSeo } from '../hooks/usePageSeo'
import { appHomePath } from '../utils/navigation'
import {
  PADEL_RULES_FOOTER,
  PADEL_RULES_INTRO,
  PADEL_RULES_SECTIONS,
} from '../utils/padelRulesContent'
import { downloadCommonPadelRulesPdf } from '../utils/rulesPdf'
import './Legal.css'

/**
 * Plain-English padel basics for student / social events.
 * Aligned with common FIP / LTA club guidance (not a full rulebook).
 */
export default function PadelRulesPage() {
  const { user } = useAuth()
  const [pdfError, setPdfError] = useState('')
  usePageSeo({
    title: 'Common padel rules',
    description:
      'Simple padel rules for student and social tournaments: serve, glass walls, mesh, lets, and scoring.',
    path: '/padel-rules',
  })

  const onDownload = () => {
    setPdfError('')
    try {
      downloadCommonPadelRulesPdf()
    } catch {
      setPdfError('Couldn’t create the PDF. Try again, or use Print → Save as PDF.')
    }
  }

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page legal-page">
        <BackButton fallbackTo={appHomePath(user?.role)} />
        <div className="legal-head-row">
          <div>
            <h1 className="page-title">Common padel rules</h1>
            <p className="page-sub">{PADEL_RULES_INTRO}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDownload}>
            Download A4 PDF
          </button>
        </div>
        {pdfError ? <p className="form-error">{pdfError}</p> : null}

        <div className="legal-body">
          {PADEL_RULES_SECTIONS.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              <ul>
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </section>
          ))}

          <p>{PADEL_RULES_FOOTER}</p>
          <p>
            Full competition rulebook:{' '}
            <a
              href="https://www.padelfip.com/wp-content/uploads/2024/11/FIP-Rules-of-Padel.pdf"
              target="_blank"
              rel="noopener noreferrer"
            >
              International Padel Federation rules (PDF)
            </a>
            .
          </p>

          <p>
            <Link to="/tournaments">Browse tournaments</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
