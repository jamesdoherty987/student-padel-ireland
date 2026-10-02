/**
 * Deep-link path parsing tests (kept in plain JS so Node can run without a TS loader).
 * Keep in sync with src/native/deepLink.ts
 */
function pathFromAppUrl(url) {
  const raw = url?.trim()
  if (!raw) return null

  try {
    const parsed = new URL(raw)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const path = `${parsed.pathname}${parsed.search}${parsed.hash}`
      return path === '/' ? null : path
    }

    const host = parsed.hostname
    const path = parsed.pathname || ''
    if (host && host !== 'localhost' && !host.includes('.')) {
      const combined = `/${host}${path === '/' ? '' : path}${parsed.search}${parsed.hash}`
      return combined === '/' ? null : combined
    }

    const combined = `${path}${parsed.search}${parsed.hash}`
    if (!combined || combined === '/') return null
    return combined.startsWith('/') ? combined : `/${combined}`
  } catch {
    return null
  }
}

const cases = [
  ['', null],
  ['   ', null],
  ['https://studentpadelireland.ie/t/limerick-open/live', '/t/limerick-open/live'],
  ['https://studentpadelireland.ie/community/join/ABC?x=1', '/community/join/ABC?x=1'],
  ['https://studentpadelireland.ie/', null],
  ['studentpadel://t/limerick-open', '/t/limerick-open'],
  ['studentpadel:///rankings', '/rankings'],
  ['studentpadel://rankings', '/rankings'],
  ['studentpadel://', null],
  ['studentpadel:///', null],
  ['studentpadel://t/x/confirmed?registration_id=1', '/t/x/confirmed?registration_id=1'],
  ['not a url', null],
]

let failed = 0
for (const [input, expected] of cases) {
  const got = pathFromAppUrl(input)
  if (got !== expected) {
    console.error(
      `FAIL pathFromAppUrl(${JSON.stringify(input)}) => ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`,
    )
    failed++
  }
}

if (failed) {
  process.exit(1)
}
console.log(`deep-link checks passed (${cases.length})`)
