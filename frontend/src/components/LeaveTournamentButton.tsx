import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, tournamentApi } from '../services/api'

type Props = {
  tournamentId: string
  slug: string
  paymentStatus?: string | null
  teamName?: string | null
  singles?: boolean
  /** Extra class on the button */
  className?: string
  /** Called after a successful leave (before query invalidation settles) */
  onLeft?: () => void
  children?: string
}

function confirmMessage(
  paymentStatus: string | null | undefined,
  teamName: string | null | undefined,
  singles: boolean,
) {
  const label = teamName ? `“${teamName}”` : singles ? 'your entry' : 'your team'
  if (!singles) {
    if (paymentStatus === 'PAID') {
      return (
        `Withdraw ${label}? This removes the whole doubles team (you and your partner). ` +
        `Entry fees are not refunded automatically — contact the organiser if you need a refund. ` +
        `If a draw already exists, the organiser may need to regenerate fixtures.`
      )
    }
    return `Cancel ${label}? This cancels the whole doubles entry so you and your partner can join differently.`
  }
  if (paymentStatus === 'PAID') {
    return (
      `Withdraw ${label}? You’ll free your spot before the event starts. ` +
      `Entry fees are not refunded automatically — contact the organiser if you need a refund.`
    )
  }
  return `Cancel ${label}? You can join again later if spots are still open.`
}

function defaultLabel(paymentStatus: string | null | undefined, singles: boolean) {
  if (paymentStatus === 'PAID') return singles ? 'Withdraw entry' : 'Withdraw team'
  return singles ? 'Cancel entry' : 'Cancel team entry'
}

export default function LeaveTournamentButton({
  tournamentId,
  slug,
  paymentStatus,
  teamName,
  singles = false,
  className = 'btn btn-ghost',
  onLeft,
  children,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const qc = useQueryClient()

  const label = children || defaultLabel(paymentStatus, singles)

  const onClick = async () => {
    if (!window.confirm(confirmMessage(paymentStatus, teamName, singles))) return
    setLoading(true)
    setError('')
    try {
      await tournamentApi.leaveTournament(tournamentId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['player-view', slug] }),
        qc.invalidateQueries({ queryKey: ['tournament', slug] }),
        qc.invalidateQueries({ queryKey: ['tournaments'] }),
        qc.invalidateQueries({ queryKey: ['matches', slug] }),
        qc.invalidateQueries({ queryKey: ['org-teams'] }),
        qc.invalidateQueries({ queryKey: ['organiser-dashboard'] }),
      ])
      onLeft?.()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Could not leave tournament'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="leave-tour-wrap">
      <button type="button" className={className} disabled={loading} onClick={() => void onClick()}>
        {loading ? 'Leaving…' : label}
      </button>
      {error && <p className="auth-error leave-tour-error">{error}</p>}
    </div>
  )
}
