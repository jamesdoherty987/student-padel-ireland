import { cleanInviteCode } from './inviteCode'

const PREFIX = 'spi_private_invite:'

function storageKey(ref: string) {
  return `${PREFIX}${ref}`
}

/** Remember an invite code after QR / code join so private event pages keep working. */
export function rememberPrivateInvite(ref: string | undefined | null, code: string | undefined | null) {
  if (!ref) return
  const cleaned = cleanInviteCode(code || '')
  if (cleaned.length < 6) return
  try {
    sessionStorage.setItem(storageKey(ref), cleaned)
  } catch {
    /* private / quota */
  }
}

export function getRememberedPrivateInvite(ref: string | undefined | null): string | undefined {
  if (!ref) return undefined
  try {
    const cleaned = cleanInviteCode(sessionStorage.getItem(storageKey(ref)) || '')
    return cleaned.length >= 6 ? cleaned : undefined
  } catch {
    return undefined
  }
}

/** Prefer URL/code arg, then remembered by id/slug. */
export function resolvePrivateInviteCode(opts: {
  code?: string | null
  slug?: string | null
  tournamentId?: string | null
}): string | undefined {
  const fromArg = cleanInviteCode(opts.code || '')
  if (fromArg.length >= 6) return fromArg
  return (
    getRememberedPrivateInvite(opts.tournamentId) ||
    getRememberedPrivateInvite(opts.slug) ||
    undefined
  )
}
