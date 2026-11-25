/** Parse a loose semver-ish string into numeric parts. */
export function parseSemver(raw: string): number[] {
  const match = String(raw || '')
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!match) return [0, 0, 0]
  return [Number(match[1] || 0), Number(match[2] || 0), Number(match[3] || 0)]
}

/** True when `a` is strictly greater than `b` (e.g. 1.0.20 > 1.0.19). */
export function isSemverNewer(a: string, b: string): boolean {
  const left = parseSemver(a)
  const right = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    if (left[i] > right[i]) return true
    if (left[i] < right[i]) return false
  }
  return false
}
