import { platformApi } from '../services/api'

export type InviteKind = 'tournament' | 'competition'

export type ResolvedInvite = {
  kind: InviteKind
  slug: string
  name: string
  invite_code: string
  join_path: string
  hint: string
}

export function cleanInviteCode(raw: string) {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}

/** True when the string looks like an invite code (not a city/name search). */
export function looksLikeInviteCode(raw: string) {
  const cleaned = cleanInviteCode(raw)
  return cleaned.length >= 6 && cleaned.length <= 12 && /^[A-Z0-9]+$/.test(cleaned) && !/\s/.test(raw.trim())
}

/** Resolve any invite code (tournament event or friend competition). */
export async function resolveInviteCode(raw: string): Promise<ResolvedInvite> {
  const code = cleanInviteCode(raw)
  if (code.length < 6) {
    throw new Error('Enter the full invite code (at least 6 characters)')
  }
  const { data } = await platformApi.resolveInvite(code)
  return data
}
