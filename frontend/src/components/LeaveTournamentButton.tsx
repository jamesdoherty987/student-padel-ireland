import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { confirmDialog } from './ConfirmDialog'
import { apiErrorMessage, tournamentApi } from '../services/api'

type Props = {
  tournamentId: string
  slug: string
  paymentStatus?: string | null
  paymentVia?: string | null
  /** When false, confirm copy says too close for a refund (default true) */
  refundsOnWithdrawal?: boolean
  teamName?: string | null
  singles?: boolean
  /** Extra class on the button */
  className?: string
  /** Called after a successful leave (before query invalidation settles) */
  onLeft?: () => void
  children?: string
}

function feeNote(paymentVia: string | null | undefined, refundsOnWithdrawal: boolean) {
  if (paymentVia === 'pay_on_arrival') {
    return `You haven’t paid online - this just frees your spot.`
  }
  if (refundsOnWithdrawal) {
    return `Entry fees are not refunded automatically - contact the admin if you need a refund.`
  }
  return `It’s too close to the tournament - withdrawals aren’t refunded.`
}

function confirmMessage(
  paymentStatus: string | null | undefined,
  paymentVia: string | null | undefined,
  teamName: string | null | undefined,
  singles: boolean,
  refundsOnWithdrawal: boolean,
) {
  const label = teamName ? `“${teamName}”` : singles ? 'your entry' : 'your team'
  const note = feeNote(paymentVia, refundsOnWithdrawal)
  if (!singles) {
    if (paymentStatus === 'PAID') {
      return (
        `Leave ${label}? This removes the whole doubles team (you and your partner) so either of you can re-enter. ` +
        `${note} ` +
        `You can only leave before the draw is published.`
      )
    }
    return `Leave ${label}? This cancels the whole doubles entry so you and your partner can join differently.`
  }
  if (paymentStatus === 'PAID') {
    return `Withdraw ${label}? You’ll free your spot before the draw is published. ${note}`
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
  paymentVia,
  refundsOnWithdrawal = true,
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
    const ok = await confirmDialog({
      title: paymentStatus === 'PAID' ? 'Withdraw?' : 'Cancel entry?',
      message: confirmMessage(
        paymentStatus,
        paymentVia,
        teamName,
        singles,
        refundsOnWithdrawal,
      ),
      confirmLabel: paymentStatus === 'PAID' ? 'Withdraw' : 'Cancel entry',
      cancelLabel: 'Keep playing',
      danger: true,
    })
    if (!ok) return
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
        qc.invalidateQueries({ queryKey: ['manage-dashboard'] }),
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
