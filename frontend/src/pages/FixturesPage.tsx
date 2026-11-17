import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import BackButton from '../components/BackButton'
import NavBar from '../components/NavBar'
import { usePageSeo } from '../hooks/usePageSeo'
import { tournamentApi, type Match } from '../services/api'
import {
  courtLabel,
  formatDate,
  formatMatchScore,
  formatTime,
  knockoutRoundLabel,
  knockoutRoundOrder,
  statusLabel,
} from '../utils/format'
import { downloadGroupFixturesPdf } from '../utils/fixturesPdf'
import { cleanInviteCode } from '../utils/inviteCode'
import { getRememberedPrivateInvite } from '../utils/privateEventAccess'
import './Fixtures.css'
import './Tournament.css'

function sideName(m: Match, side: 'a' | 'b') {
  if (side === 'a') return m.team_a_name || m.team_a_placeholder || 'TBD'
  return m.team_b_name || m.team_b_placeholder || 'TBD'
}

function groupKey(m: Match) {
  if (m.stage === 'GROUP' && m.round?.startsWith('GROUP_')) {
    return m.round.replace('GROUP_', '')
  }
  return m.round || ''
}

function matchSort(a: Match, b: Match) {
  const ta = a.scheduled_start ? new Date(a.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER
  const tb = b.scheduled_start ? new Date(b.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER
  if (ta !== tb) return ta - tb
  return (a.sort_order || 0) - (b.sort_order || 0)
}

type SheetSection = {
  id: string
  title: string
  matches: Match[]
}

export default function FixturesPage() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const [pdfError, setPdfError] = useState('')
  const inviteFromUrl = cleanInviteCode(params.get('code') || '')
  const inviteCode =
    inviteFromUrl.length >= 6 ? inviteFromUrl : getRememberedPrivateInvite(slug) || ''

  const { data: tournament, isLoading: tLoading, isError: tError } = useQuery({
    queryKey: ['tournament', slug, inviteCode || ''],
    queryFn: async () =>
      (await tournamentApi.get(slug, { code: inviteCode || undefined })).data,
    enabled: !!slug,
  })

  const { data: matches = [], isLoading: mLoading } = useQuery({
    queryKey: ['matches', slug, inviteCode || '', 'fixtures-sheet'],
    queryFn: async () =>
      (await tournamentApi.matches(slug, { code: inviteCode || undefined })).data,
    enabled: !!slug && !!tournament,
  })

  usePageSeo({
    title: tournament ? `${tournament.name} fixtures` : 'Fixtures',
    description: tournament
      ? `Full fixture list for ${tournament.name} at ${tournament.venue}.`
      : 'Tournament fixtures',
    path: `/t/${slug}/fixtures`,
  })

  const sections = useMemo(() => {
    const out: SheetSection[] = []
    const groups = new Map<string, Match[]>()
    const championship: Match[] = []
    const plate: Match[] = []
    const other: Match[] = []

    for (const m of matches) {
      if (m.stage === 'GROUP') {
        const key = groupKey(m) || '?'
        const list = groups.get(key) || []
        list.push(m)
        groups.set(key, list)
      } else if (m.stage === 'KNOCKOUT') {
        championship.push(m)
      } else if (m.stage === 'PLATE') {
        plate.push(m)
      } else {
        other.push(m)
      }
    }

    const groupLetters = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b))
    for (const letter of groupLetters) {
      out.push({
        id: `group-${letter}`,
        title: `Group ${letter}`,
        matches: (groups.get(letter) || []).slice().sort(matchSort),
      })
    }

    const byKnockoutRound = (list: Match[]) => {
      const map = new Map<string, Match[]>()
      for (const m of list) {
        const key = m.round || 'Match'
        const arr = map.get(key) || []
        arr.push(m)
        map.set(key, arr)
      }
      return Array.from(map.entries())
        .sort((a, b) => knockoutRoundOrder(a[0]) - knockoutRoundOrder(b[0]))
        .map(([round, ms]) => ({ round, matches: ms.slice().sort(matchSort) }))
    }

    for (const block of byKnockoutRound(championship)) {
      out.push({
        id: `champ-${block.round}`,
        title: knockoutRoundLabel(block.round, 'KNOCKOUT'),
        matches: block.matches,
      })
    }
    for (const block of byKnockoutRound(plate)) {
      out.push({
        id: `plate-${block.round}`,
        title: knockoutRoundLabel(block.round, 'PLATE'),
        matches: block.matches,
      })
    }
    if (other.length) {
      out.push({
        id: 'other',
        title: 'Other fixtures',
        matches: other.slice().sort(matchSort),
      })
    }
    return out
  }, [matches])

  const livePath = inviteCode
    ? `/t/${slug}/live?code=${encodeURIComponent(inviteCode)}`
    : `/t/${slug}/live`
  const eventPath = inviteCode
    ? `/t/${slug}?code=${encodeURIComponent(inviteCode)}`
    : `/t/${slug}`

  const groupMatchCount = useMemo(
    () => matches.filter((m) => m.stage === 'GROUP').length,
    [matches],
  )

  const whenLabel = tournament
    ? `${formatDate(tournament.event_date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${formatTime(tournament.start_time)}`
    : ''

  const onDownloadGroups = () => {
    if (!tournament) return
    setPdfError('')
    try {
      downloadGroupFixturesPdf({
        tournamentName: tournament.name,
        venue: tournament.venue,
        whenLabel,
        matches,
      })
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Couldn’t create the PDF.')
    }
  }

  if (tLoading || mLoading) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ height: 28, width: '55%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 220 }} />
        </main>
      </div>
    )
  }

  if (tError || !tournament) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">Fixtures</h1>
          <p className="page-sub">Couldn’t load this event.</p>
          <Link to="/tournaments" className="btn btn-primary">
            Browse tournaments
          </Link>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell fixtures-shell">
      <NavBar />
      <main className="page fixtures-page">
        <BackButton fallbackTo={eventPath} />
        <header className="fixtures-head">
          <p className="fixtures-kicker">Master sheet</p>
          <h1 className="page-title">{tournament.name}</h1>
          <p className="page-sub page-sub-tight">
            {tournament.venue} ·{' '}
            {formatDate(tournament.event_date, { weekday: 'short', day: 'numeric', month: 'short' })}{' '}
            · {formatTime(tournament.start_time)}
          </p>
          <p className="fixtures-meta">
            {statusLabel(tournament.status)} · {matches.length} fixture
            {matches.length === 1 ? '' : 's'}
          </p>
          <div className="fixtures-actions">
            <Link to={livePath} className="btn btn-primary btn-sm">
              Live board
            </Link>
            <Link to={eventPath} className="btn btn-ghost btn-sm">
              Event page
            </Link>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onDownloadGroups}
              disabled={groupMatchCount === 0}
              title={
                groupMatchCount === 0
                  ? 'No group fixtures yet'
                  : 'Download group-stage fixtures as A4 PDF'
              }
            >
              Download groups PDF
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>
              Print all
            </button>
          </div>
          {pdfError ? <p className="form-error fixtures-pdf-error">{pdfError}</p> : null}
          {groupMatchCount > 0 ? (
            <p className="fixtures-pdf-hint">
              PDF includes group games only (saves space). Large draws use a compact multi-page A4
              layout.
            </p>
          ) : null}
        </header>

        {matches.length === 0 ? (
          <div className="empty-state">
            <p>No fixtures yet. Generate the draw to see the master sheet.</p>
            <Link to={eventPath} className="btn btn-primary">
              Back to event
            </Link>
          </div>
        ) : (
          <div className="fixtures-sheet">
            {sections.map((section) => (
              <section key={section.id} className="fixtures-section" id={section.id}>
                <h2>{section.title}</h2>
                <div className="fixtures-table-wrap">
                  <table className="fixtures-table">
                    <thead>
                      <tr>
                        <th scope="col">Time</th>
                        <th scope="col">Court</th>
                        <th scope="col">Match</th>
                        <th scope="col">Status</th>
                        <th scope="col">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.matches.map((m) => {
                        const done =
                          m.status === 'COMPLETED' ||
                          m.status === 'WALKOVER' ||
                          m.status === 'CANCELLED'
                        const scoreText = m.score ? formatMatchScore(m.score) : ''
                        return (
                          <tr key={m.id} className={done ? 'is-done' : undefined}>
                            <td className="fixtures-time">{formatTime(m.scheduled_start)}</td>
                            <td className="fixtures-court">
                              {courtLabel(m.court_name, m.court_number)}
                            </td>
                            <td className="fixtures-match">
                              <div className="fixtures-sides">
                                <span className="fixtures-side">{sideName(m, 'a')}</span>
                                <span className="fixtures-vs">vs</span>
                                <span className="fixtures-side">{sideName(m, 'b')}</span>
                              </div>
                            </td>
                            <td className="fixtures-status">{statusLabel(m.status)}</td>
                            <td
                              className="fixtures-score"
                              data-empty={scoreText ? undefined : 'true'}
                            >
                              {scoreText || '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
