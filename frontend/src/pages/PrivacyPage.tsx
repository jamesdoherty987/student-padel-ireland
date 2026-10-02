import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import './Legal.css'

export default function PrivacyPage() {
  return (
    <div className="app-shell">
      <NavBar />
      <main className="page legal-page">
        <p className="eyebrow">
          <Link to="/">← Home</Link>
        </p>
        <h1 className="page-title">Privacy Policy</h1>
        <p className="page-sub">Last updated: 1 October 2026</p>

        <div className="legal-body">
          <p>
            Student Padel Ireland (&quot;we&quot;, &quot;us&quot;) operates the Student Padel Ireland website and
            mobile apps. This policy explains what personal data we collect and why.
          </p>

          <h2>Who we are</h2>
          <p>
            Contact: <a href="mailto:jkdoherty123@gmail.com">jkdoherty123@gmail.com</a>
          </p>

          <h2>Data we collect</h2>
          <ul>
            <li>Account details: name, email, password (stored hashed), optional phone, university, student number</li>
            <li>Profile content: bio, photos, and short videos you upload</li>
            <li>Competition data: tournament entries, community matches, rankings, and friend connections</li>
            <li>Payment metadata: Stripe processes card payments; we store payment status and amounts, not full card numbers</li>
            <li>Technical data: basic device/app diagnostics needed to run the service</li>
          </ul>

          <h2>Why we use it</h2>
          <ul>
            <li>Create and manage your account</li>
            <li>Run tournaments, community competitions, live scores, and rankings</li>
            <li>Process entry fees and send transactional messages when email is configured</li>
            <li>Keep the platform secure and reliable</li>
          </ul>

          <h2>Legal bases</h2>
          <p>
            We process data to perform our contract with you (running the app and events), and where needed for
            legitimate interests such as fraud prevention and product improvement. Where required, we rely on your
            consent (for example optional profile media).
          </p>

          <h2>Sharing</h2>
          <p>
            We use processors that help us operate the service (hosting, database, and Stripe for payments). We do
            not sell your personal data. Public profiles, rankings, and competition results may be visible to other
            users as part of the product.
          </p>

          <h2>Retention</h2>
          <p>
            We keep account and competition records while your account is active and as needed for event history.
            When you delete your account in the app, we anonymise your personal details and remove profile media.
            Some tournament history may remain in anonymised form so past events stay intact.
          </p>

          <h2>Your rights</h2>
          <p>
            You can access and update profile information in the app. You can delete your account from your profile
            (password confirmation required). You may also email us to exercise GDPR rights (access, correction,
            erasure, restriction, objection, portability) where applicable.
          </p>

          <h2>Children</h2>
          <p>
            The service is aimed at university students and adults. It is not directed at children under 16.
          </p>

          <h2>Changes</h2>
          <p>
            We may update this policy. The &quot;Last updated&quot; date above will change when we do. Continued use
            after changes means you accept the updated policy.
          </p>
        </div>
      </main>
    </div>
  )
}
