import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import './Legal.css'

export default function TermsPage() {
  return (
    <div className="app-shell">
      <NavBar />
      <main className="page legal-page">
        <p className="eyebrow">
          <Link to="/">← Home</Link>
        </p>
        <h1 className="page-title">Terms of Use</h1>
        <p className="page-sub">Last updated: 1 October 2026</p>

        <div className="legal-body">
          <p>
            These terms govern use of the Student Padel Ireland website and mobile apps. By creating an account or
            using the service, you agree to them.
          </p>

          <h2>The service</h2>
          <p>
            We provide tools for discovering and joining student padel tournaments in Ireland, logging community
            matches, rankings, and related features. Event organisers remain responsible for their own venue rules,
            safety, and on-court conduct.
          </p>

          <h2>Accounts</h2>
          <ul>
            <li>Provide accurate information and keep your login secure</li>
            <li>You must be old enough to form a binding contract in Ireland (typically 18+ for paid entries)</li>
            <li>You may delete your account from your profile at any time</li>
          </ul>

          <h2>Acceptable use</h2>
          <ul>
            <li>Do not harass others, upload illegal or abusive content, or attempt to disrupt the service</li>
            <li>Do not scrape, reverse engineer, or misuse APIs beyond normal app use</li>
            <li>Organisers must only enter scores and team data they are authorised to manage</li>
          </ul>

          <h2>Payments</h2>
          <p>
            Tournament entry fees are charged by organisers via Stripe Checkout when enabled. Fees, refunds, and
            cancellations for a specific event are set by that event&apos;s organiser unless we state otherwise.
            Stripe&apos;s terms also apply to card payments.
          </p>

          <h2>Content</h2>
          <p>
            You keep ownership of photos and text you upload. You grant us a licence to host and display them in the
            app so profiles and competitions work. Do not upload content you do not have rights to share.
          </p>

          <h2>Availability</h2>
          <p>
            We aim for reliable uptime but do not guarantee uninterrupted access. Features may change as the product
            develops.
          </p>

          <h2>Liability</h2>
          <p>
            To the fullest extent permitted by Irish law, we are not liable for indirect or consequential losses, or
            for injuries or disputes arising from on-court play or third-party venues. Nothing in these terms limits
            rights you cannot waive under consumer law.
          </p>

          <h2>Contact</h2>
          <p>
            Questions: <a href="mailto:hello@studentpadelireland.ie">hello@studentpadelireland.ie</a>
          </p>
        </div>
      </main>
    </div>
  )
}
