import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query'

const CACHE_KEY = 'isp_rq_cache_v1'
const PERSIST_KEYS = new Set([
  'tournaments',
  'rankings',
  'friends',
  'community-home',
  'notifications',
  'universities',
])

let saveTimer: ReturnType<typeof setTimeout> | null = null

function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0]
  return typeof root === 'string' && PERSIST_KEYS.has(root)
}

export function restoreQueryCache(client: QueryClient) {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return
    const data = JSON.parse(raw) as unknown
    hydrate(client, data as Parameters<typeof hydrate>[1])
  } catch {
    try {
      localStorage.removeItem(CACHE_KEY)
    } catch {
      /* ignore */
    }
  }
}

export function schedulePersistQueryCache(client: QueryClient) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const state = dehydrate(client, {
        shouldDehydrateQuery: (query) =>
          query.state.status === 'success' && shouldPersistQuery(query.queryKey),
      })
      localStorage.setItem(CACHE_KEY, JSON.stringify(state))
    } catch {
      /* ignore quota */
    }
  }, 400)
}

export function clearQueryCachePersist() {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* ignore */
  }
}
