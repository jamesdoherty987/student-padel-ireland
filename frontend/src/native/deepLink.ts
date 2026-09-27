/** Parse Capacitor / universal / custom-scheme URLs into in-app router paths. */
export function pathFromAppUrl(url: string): string | null {
  const raw = url?.trim()
  if (!raw) return null

  try {
    // Universal links: https://studentpadelireland.ie/t/foo/...
    // Custom scheme: studentpadel://t/foo/...  or studentpadel:///t/foo
    const parsed = new URL(raw)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const path = `${parsed.pathname}${parsed.search}${parsed.hash}`
      return path === '/' ? null : path
    }

    // custom scheme — hostname may be the first path segment (studentpadel://t/slug)
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
