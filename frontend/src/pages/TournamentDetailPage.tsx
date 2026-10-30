import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import BackButton from '../components/BackButton'
import LeaveTournamentButton from '../components/LeaveTournamentButton'
import NavBar from '../components/NavBar'
import { ShareQr } from '../components/ShareQr'
import SponsorStrip from '../components/SponsorStrip'
import TournamentBracket from '../components/TournamentBracket'
import { useAuth } from '../context/AuthContext'
import { usePageSeo } from '../hooks/usePageSeo'
import { tournamentApi, type Match } from '../services/api'
import { publicPathUrl } from '../native/platform'
import {
  bracketFormatHint,
  courtLabel,
  currentSetScores,
  formatDate,
  formatMatchScore,
  formatMoney,
  formatRelativeStart,
  perPlayerFeeCents,
  formatTime,
  isKnockoutActive,
  isPastCalendarDate,
  knockoutRoundLabel,
  reminderPromiseCopy,
  statusLabel,
  tournamentFormatSummary,
} from '../utils/format'
import './Tournament.css'

export default function TournamentDetailPage() {
  const { slug = '' } = useParams()
  const { user } = useAuth()
  const [shareTab, setShareTab] = useState<'invite' | 'live'>('invite')
  const { data: tournament, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['tournament', slug, user?.id],
    queryFn: async () => (await tournamentApi.get(slug)).data,
    enabled: !!slug,
    retry: 4,
  })
  const { data: announcements = [] } = useQuery({
    queryKey: ['announcements', slug],
    queryFn: async () => (await tournamentApi.announcements(slug)).data,
    enabled: !!slug,
  })
  const { data: sponsors = [] } = useQuery({
    queryKey: ['sponsors', slug],
    queryFn: async () => (await tournamentApi.sponsors(slug)).data,
    enabled: !!slug,
    staleTime: 60_000,
  })
  const { data: matches = [] } = useQuery({
    queryKey: ['matches', slug],
    queryFn: async () => (await tournamentApi.matches(slug)).data,
    enabled: !!slug,
    refetchInterval: 12000,
  })

  const {
    data: playerView,
    isError: playerViewError,
    isPending: playerViewPending,
    refetch: refetchPlayerView,
  } = useQuery({
    queryKey: ['player-view', slug],
    queryFn: async () => (await tournamentApi.playerView(slug)).data,
    enabled: !!slug && !!user,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 12000,
  })

  usePageSeo(
    tournament
      ? {
          title: `${tournament.name} - ${tournament.location}`,
          description: `${tournament.name} student padel tournament in ${tournament.location} at ${tournament.venue}. Register, follow live scores, and climb the Ireland rankings on Student Padel Ireland.`,
          path: `/t/${tournament.slug}`,
        }
      : {
          title: 'Tournament',
          description: 'Student padel tournament on Student Padel Ireland.',
          path: slug ? `/t/${slug}` : '/tournaments',
        },
  )

  const isOps = !!user && !!tournament?.can_manage

  if (isLoading) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ width: '60%', height: 32, marginBottom: 12 }} />
          <div className="skeleton" style={{ width: '40%', height: 18 }} />
        </main>
      </div>
    )
  }

  if (isError || !tournament) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">Could not load this tournament</h1>
          <p className="page-sub">The server may be waking up. Try again in a few seconds.</p>
          <div className="header-actions" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-primary" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? 'Retrying...' : 'Retry'}
            </button>
            <Link to="/tournaments" className="btn btn-ghost">
              Browse tournaments
            </Link>
          </div>
        </main>
      </div>
    )
  }

  const live = matches.filter((m) => m.status === 'LIVE')
  const pendingConfirm = matches.filter((m) => m.status === 'AWAITING_CONFIRM').slice(0, 6)
  const upcoming = matches
    .filter((m) => m.status === 'SCHEDULED' || m.status === 'CALLED')
    .slice(0, 8)
  const championshipMatches = matches.filter((m) => m.stage === 'KNOCKOUT')
  const plateMatches = matches.filter((m) => m.stage === 'PLATE')
  const knockoutMatches = [...championshipMatches, ...plateMatches]
  const knockoutActive = isKnockoutActive(matches)
  const liveUrl = publicPathUrl(`/t/${tournament.slug}/live`)
  const joinUrl = tournament.invite_code
    ? publicPathUrl(`/join/${tournament.invite_code}`)
    : publicPathUrl(`/t/${tournament.slug}/join`)
  const myTeamInfo = playerView?.my_team as
    | {
        id?: string
        payment_status?: string
        payment_via?: string | null
        slot?: number | null
        name?: string
        players?: string[]
        can_leave?: boolean
        needs_partner?: boolean
        partner_invite_pending?: boolean
      }
    | null
  const nextMatch = (playerView?.next_match as Match | null | undefined) || null
  const myPayment = myTeamInfo?.payment_status
  const myPaymentVia = myTeamInfo?.payment_via
  const mySlot = myTeamInfo?.slot ?? null
  const hasPaidEntry = !!myTeamInfo && myPayment === 'PAID'
  const nextOpponent = (() => {
    if (!nextMatch || !myTeamInfo?.id) return null
    if (nextMatch.team_a_id === myTeamInfo.id) {
      return nextMatch.team_b_name || nextMatch.team_b_placeholder || 'Opponent'
    }
    if (nextMatch.team_b_id === myTeamInfo.id) {
      return nextMatch.team_a_name || nextMatch.team_a_placeholder || 'Opponent'
    }
    return null
  })()
  const nextWhenLabel = (() => {
    if (!nextMatch) return ''
    if (nextMatch.status === 'CALLED') return 'Called now'
    if (nextMatch.status === 'LIVE') return 'Playing now'
    if (nextMatch.status === 'AWAITING_CONFIRM') return 'Confirm score'
    const clock = formatTime(nextMatch.scheduled_start)
    const relative = formatRelativeStart(nextMatch.scheduled_start)
    return relative ? `${clock} · ${relative}` : clock
  })()
  const needsPartner = !!myTeamInfo?.needs_partner && mySlot === 1
  const partnerInvitePending = !!myTeamInfo?.partner_invite_pending && mySlot === 2
  const owesAtVenue = hasPaidEntry && myPaymentVia === 'pay_on_arrival'
  const hasPendingCaptain = !!myTeamInfo && myPayment === 'PENDING' && mySlot === 1
  const isListedPartner = !!myTeamInfo && myPayment === 'PENDING' && mySlot !== 1
  const canLeave = !!myTeamInfo?.can_leave
  const myTeamId = hasPaidEntry && myTeamInfo?.id ? myTeamInfo.id : undefined

  const singles = tournament.play_format === 'SINGLES'
  const registrationOpen =
    tournament.status === 'REGISTRATION_OPEN' && !isPastCalendarDate(tournament.registration_deadline)
  const hasSpot = tournament.registered_teams < tournament.max_teams
  const eventStarted =
    tournament.status === 'LIVE' ||
    tournament.status === 'COMPLETED' ||
    tournament.status === 'CANCELLED'
  const reminderNote = reminderPromiseCopy(tournament.event_date)
  const preStart =
    hasPaidEntry &&
    !eventStarted &&
    matches.length === 0 &&
    tournament.status !== 'COMPLETED' &&
    tournament.status !== 'CANCELLED'
  const matchDay =
    hasPaidEntry &&
    (tournament.status === 'LIVE' || matches.length > 0) &&
    tournament.status !== 'CANCELLED'
  // Don't offer join/resume until we know whether the user already has an entry
  const entryUnknown = !!user && (playerViewPending || playerViewError)
  const canResumePayment = hasPendingCaptain && !eventStarted
  const canJoin =
    registrationOpen &&
    !entryUnknown &&
    !hasPaidEntry &&
    !isListedPartner &&
    !hasPendingCaptain &&
    hasSpot
  const showInvite = !!tournament.invite_code && (canJoin || isOps || hasPendingCaptain)
  const activeShareTab = showInvite ? shareTab : 'live'

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page tourney-detail">
        <BackButton fallbackTo="/tournaments" />
        <p className="tour-card-kind tour-detail-kind">
          {tournament.is_official ? 'Official' : 'Personal'}
          <span aria-hidden> · </span>
          {statusLabel(tournament.status)}
          <span aria-hidden> · </span>
          {tournament.location}
        </p>
        <h1 className="page-title">{tournament.name}</h1>
        <p className="page-sub page-sub-tight">
          {tournament.venue} · {formatDate(tournament.event_date, { day: 'numeric', month: 'short' })} ·{' '}
          {formatTime(tournament.start_time)}
        </p>
        <p className="tour-format-line">{tournamentFormatSummary(tournament.play_format, tournament.format)}</p>
        {registrationOpen && (
          <p className="tour-format-hint muted">{bracketFormatHint(tournament.format)}</p>
        )}

        {needsPartner && (
          <div className="tour-entry-banner tour-entry-banner--alert" role="status">
            <p className="tour-entry-badge">Partner needed</p>
            <h2 className="tour-entry-title">Your spot is held</h2>
            <p className="tour-entry-body">
              Your partner left the team. Add someone new to stay in the event - your entry stays
              paid.
            </p>
            <div className="tour-entry-actions">
              <Link to={`/t/${tournament.slug}/join`} className="btn btn-primary">
                Add partner
              </Link>
            </div>
          </div>
        )}

        {partnerInvitePending && (
          <div className="tour-entry-banner tour-entry-banner--alert" role="status">
            <p className="tour-entry-badge">Team invite</p>
            <h2 className="tour-entry-title">You’re on {myTeamInfo?.name || 'a team'}</h2>
            <p className="tour-entry-body">
              Your teammate registered and pays for both of you. Accept to stay on the team, or
              Decline to leave.
            </p>
            <div className="tour-entry-actions">
              <Link to={`/t/${tournament.slug}/live`} className="btn btn-primary">
                Respond to invite
              </Link>
            </div>
          </div>
        )}

        {hasPaidEntry && !needsPartner && !partnerInvitePending && (
          <div
            className={`tour-entry-banner${matchDay ? ' tour-entry-banner--live' : ''}${nextMatch ? ' tour-entry-banner--next' : ''}`}
            role="status"
          >
            <p className="tour-entry-badge">You’re in</p>
            {nextMatch ? (
              <>
                <p className="tour-entry-next-kicker">
                  {nextMatch.status === 'CALLED'
                    ? 'Go to court now'
                    : nextMatch.status === 'LIVE'
                      ? 'Playing now'
                      : nextMatch.status === 'AWAITING_CONFIRM'
                        ? 'Confirm your score'
                        : 'Your next match'}
                </p>
                <div className="tour-next-glance" aria-label="Your next match">
                  <div className="tour-next-glance-fact">
                    <span className="tour-next-glance-label">Court</span>
                    <strong>{courtLabel(nextMatch.court_name, nextMatch.court_number)}</strong>
                  </div>
                  <div className="tour-next-glance-fact">
                    <span className="tour-next-glance-label">When</span>
                    <strong>{nextWhenLabel}</strong>
                  </div>
                </div>
                <h2 className="tour-entry-title tour-entry-title--vs">
                  vs {nextOpponent || 'TBD'}
                </h2>
                <p className="tour-entry-players">
                  {knockoutRoundLabel(nextMatch.round, nextMatch.stage)}
                  {myTeamInfo?.name ? ` · ${myTeamInfo.name}` : ''}
                  {myTeamInfo?.players?.length ? ` · ${myTeamInfo.players.join(' / ')}` : ''}
                </p>
              </>
            ) : (
              <>
                <h2 className="tour-entry-title">
                  {myTeamInfo?.name || (singles ? 'Your entry' : 'Your team')}
                </h2>
                {myTeamInfo?.players?.length ? (
                  <p className="tour-entry-players">{myTeamInfo.players.join(' · ')}</p>
                ) : null}
                <ul className="tour-entry-facts">
                  <li>
                    {owesAtVenue
                      ? `Pay ${formatMoney(tournament.entry_fee_cents, tournament.currency)} at the venue`
                      : 'Entry paid'}
                  </li>
                  <li>
                    {matchDay
                      ? 'Match day - your court and opponent will show here when set'
                      : preStart
                        ? reminderNote
                          ? `Draw not published yet · ${reminderNote}`
                          : 'Waiting for the organiser to publish the draw'
                        : reminderNote || 'Your spot is confirmed'}
                  </li>
                </ul>
              </>
            )}
            <div className="tour-entry-actions">
              <Link to={`/t/${tournament.slug}/live`} className="btn btn-primary">
                {nextMatch
                  ? nextMatch.status === 'CALLED' || nextMatch.status === 'LIVE'
                    ? 'Open live match'
                    : 'Open my matches'
                  : matchDay
                    ? 'My matches'
                    : 'View my entry'}
              </Link>
              {owesAtVenue && (mySlot === 1 || mySlot == null) && (
                <Link to={`/t/${tournament.slug}/join`} className="btn btn-ghost tour-entry-btn-ghost">
                  Pay online now
                </Link>
              )}
            </div>
          </div>
        )}

        {(isListedPartner || hasPendingCaptain) && (
          <div className="tour-entry-banner tour-entry-banner--pending" role="status">
            <p className="tour-entry-badge">
              {hasPendingCaptain ? 'Payment needed' : 'Almost in'}
            </p>
            <h2 className="tour-entry-title">
              {myTeamInfo?.name || (singles ? 'Your entry' : 'Your team')}
            </h2>
            {myTeamInfo?.players?.length ? (
              <p className="tour-entry-players">{myTeamInfo.players.join(' · ')}</p>
            ) : null}
            <p className="tour-entry-body">
              {hasPendingCaptain
                ? singles
                  ? 'You’ve started this entry. Finish payment to lock your spot, or cancel below if you’ve changed your mind.'
                  : 'You registered the team. Finish payment for both players to lock the spot — your partner is invited and isn’t charged.'
                : 'Your teammate registered first and still needs to finish paying for both of you — or leave below if you want out.'}
            </p>
            {hasPendingCaptain && (
              <div className="tour-entry-actions">
                <Link to={`/t/${tournament.slug}/join`} className="btn btn-primary">
                  {singles ? 'Complete payment' : 'Pay for both players'}
                </Link>
              </div>
            )}
          </div>
        )}

        {playerViewError && user && (
          <div className="tour-entry-notes">
            <p className="muted-note">
              Could not check your entry status.{' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refetchPlayerView()}>
                Retry
              </button>
            </p>
          </div>
        )}

        {tournament.status === 'REGISTRATION_OPEN' &&
          !hasPaidEntry &&
          !isListedPartner &&
          !hasPendingCaptain &&
          (!hasSpot || isPastCalendarDate(tournament.registration_deadline)) && (
            <div className="tour-entry-notes">
              <p className="muted-note">
                {isPastCalendarDate(tournament.registration_deadline)
                  ? 'Registration closed'
                  : `Tournament is full. Check back if a ${singles ? 'player' : 'team'} withdraws.`}
              </p>
            </div>
          )}

        <SponsorStrip sponsors={sponsors} placement="hero" />

        <div className="tour-actions">
          {canJoin && (
            <Link to={`/t/${tournament.slug}/join`} className="btn btn-primary">
              {singles ? 'Join tournament' : 'Register your team'}
            </Link>
          )}
          {!hasPaidEntry && !canJoin && !canResumePayment && !isListedPartner && tournament.status === 'LIVE' && (
            <Link to={`/t/${tournament.slug}/live`} className="btn btn-ghost">
              Live scores
            </Link>
          )}
          {isOps && (
            <Link to={`/organiser?t=${tournament.id}`} className="btn btn-dark">
              Manage event
            </Link>
          )}
        </div>
        {canJoin && !singles && (
          <p className="tour-join-hint">
            One of you signs up and pays for you + your friend — they get an invite, no separate charge
          </p>
        )}

        {(canLeave || isOps) && (
          <div className="tour-actions-secondary">
            {canLeave && (
              <LeaveTournamentButton
                tournamentId={tournament.id}
                slug={tournament.slug}
                paymentStatus={myPayment}
                paymentVia={myPaymentVia}
                teamName={myTeamInfo?.name}
                singles={singles}
                className="btn btn-ghost btn-sm"
              />
            )}
            {isOps && tournament.status === 'LIVE' && (
              <Link to={`/tournament/${tournament.slug}/display`} className="btn btn-ghost btn-sm">
                TV display
              </Link>
            )}
          </div>
        )}

        <div className="tour-stats">
          {isOps && (
            <div>
              <strong>{tournament.registered_teams}</strong>
              <span>{singles ? 'Players' : 'Doubles teams'}</span>
            </div>
          )}
          <div>
            <strong>{tournament.number_of_courts}</strong>
            <span>Courts</span>
          </div>
          <div>
            <strong>{formatMoney(Math.round(perPlayerFeeCents(tournament.entry_fee_cents, tournament.play_format)), tournament.currency)}</strong>
            <span>{tournament.pay_on_arrival ? 'Per player · pay on arrival' : 'Per player'}</span>
          </div>
        </div>

        {tournament.registration_deadline && tournament.status === 'REGISTRATION_OPEN' && (
          <p className="tour-deadline">
            Register by {formatDate(tournament.registration_deadline, { day: 'numeric', month: 'short' })}
          </p>
        )}

        {(knockoutActive || live.length > 0 || upcoming.length > 0) && (
          <nav className="tour-jump" aria-label="Jump to section">
            {matchDay && (
              <Link to={`/t/${tournament.slug}/live`} className="tour-jump-link tour-jump-link--primary">
                My matches
              </Link>
            )}
            {live.length > 0 && (
              <a href="#tour-live" className="tour-jump-link">
                Live
              </a>
            )}
            {upcoming.length > 0 && (
              <a href="#tour-upcoming" className="tour-jump-link">
                Coming up
              </a>
            )}
            {knockoutActive && knockoutMatches.length > 0 && (
              <a href="#tour-draw" className="tour-jump-link">
                Draw
              </a>
            )}
          </nav>
        )}

        {knockoutActive && knockoutMatches.length > 0 && (
          <section className="block tour-bracket-block" id="tour-draw">
            {championshipMatches.length > 0 && (
              <>
                {plateMatches.length > 0 ? <h2>Championship draw</h2> : <h2>Draw</h2>}
                <TournamentBracket matches={championshipMatches} myTeamId={myTeamId} />
              </>
            )}
            {plateMatches.length > 0 && (
              <>
                <h2>Plate</h2>
                <TournamentBracket matches={plateMatches} myTeamId={myTeamId} />
              </>
            )}
          </section>
        )}

        {live.length > 0 && (
          <section className="block" id="tour-live">
            <h2>
              <span className="live-dot" /> Live now
            </h2>
            <div className="live-grid">
              {live.map((m) => {
                const s = currentSetScores(m.score)
                return (
                  <div key={m.id} className="live-tile">
                    <div className="live-court">{courtLabel(m.court_name, m.court_number)}</div>
                    <div className="live-score-row">
                      <span>{m.team_a_name || m.team_a_placeholder || 'TBD'}</span>
                      <strong>{s.a}</strong>
                    </div>
                    <div className="live-score-row">
                      <span>{m.team_b_name || m.team_b_placeholder || 'TBD'}</span>
                      <strong>{s.b}</strong>
                    </div>
                    <div className="live-set">Set {s.set}</div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {pendingConfirm.length > 0 && (
          <section className="block">
            <h2>Scores to confirm</h2>
            <ul className="match-preview-list">
              {pendingConfirm.map((m) => (
                <li key={m.id}>
                  <span className="match-preview-court">
                    {courtLabel(m.court_name, m.court_number)}
                  </span>
                  <span>
                    {m.team_a_name || m.team_a_placeholder || 'TBD'} vs{' '}
                    {m.team_b_name || m.team_b_placeholder || 'TBD'}
                  </span>
                  <span className="match-preview-time">
                    {m.score ? formatMatchScore(m.score) : 'Score logged'}
                  </span>
                </li>
              ))}
            </ul>
            {hasPaidEntry && (
              <Link to={`/t/${tournament.slug}/live`} className="form-inline-link">
                Open My matches to confirm
              </Link>
            )}
          </section>
        )}

        {upcoming.length > 0 && (
          <section className="block" id="tour-upcoming">
            <h2>Coming up</h2>
            <ul className="match-preview-list">
              {upcoming.map((m) => (
                <li key={m.id}>
                  <span className="match-preview-court">
                    {m.status === 'CALLED'
                      ? `Called · ${courtLabel(m.court_name, m.court_number)}`
                      : courtLabel(m.court_name, m.court_number)}
                  </span>
                  <span>
                    {m.team_a_name || m.team_a_placeholder || 'TBD'} vs {m.team_b_name || m.team_b_placeholder || 'TBD'}
                  </span>
                  <span className="match-preview-time">{formatTime(m.scheduled_start)}</span>
                </li>
              ))}
            </ul>
            <Link to={`/t/${tournament.slug}/live`} className="tour-inline-link">
              Full live view
            </Link>
          </section>
        )}

        {announcements.length > 0 && (
          <section className="block">
            <h2>Announcements</h2>
            {announcements.map((a: { id: string; title: string; body: string }) => (
              <div key={a.id} className="announce">
                <strong>{a.title}</strong>
                <p>{a.body}</p>
              </div>
            ))}
          </section>
        )}

        {tournament.description && (
          <section className="block">
            <h2>About</h2>
            <p>{tournament.description}</p>
          </section>
        )}

        {tournament.rules && (
          <section className="block">
            <h2>Rules</h2>
            <p className="rules">{tournament.rules}</p>
          </section>
        )}

        <section className="block qr-block">
          <h2>Share</h2>
          {showInvite && (
            <div className="section-tabs tour-share-tabs" role="tablist" aria-label="Share options">
              <button
                type="button"
                role="tab"
                aria-selected={activeShareTab === 'invite'}
                className={`section-tab${activeShareTab === 'invite' ? ' is-active' : ''}`}
                onClick={() => setShareTab('invite')}
              >
                Invite
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeShareTab === 'live'}
                className={`section-tab${activeShareTab === 'live' ? ' is-active' : ''}`}
                onClick={() => setShareTab('live')}
              >
                Live scores
              </button>
            </div>
          )}
          {activeShareTab === 'invite' ? (
            <>
              <p>
                Share the code or QR. Friends tap <strong>Code</strong> on Tournaments.
              </p>
              {tournament.invite_code && (
                <p className="invite-code-line">
                  Code <code className="share-code">{tournament.invite_code}</code>
                </p>
              )}
              <ShareQr url={joinUrl} openLabel="Open join page" />
            </>
          ) : (
            <>
              <p>Share the live board. No login needed.</p>
              <ShareQr url={liveUrl} openLabel="Open live board" showQr={false} />
            </>
          )}
        </section>
      </main>
    </div>
  )
}
