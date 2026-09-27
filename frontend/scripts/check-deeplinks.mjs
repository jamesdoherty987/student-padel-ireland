import { pathFromAppUrl } from '../src/native/deepLink.ts'

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
