import { useEffect } from 'react'

const SITE = 'https://www.studentpadel.ie'
const DEFAULT_TITLE = 'Student Padel Ireland | Student Padel Tournaments & Rankings'
const DEFAULT_DESCRIPTION =
  'Student Padel Ireland - find student padel tournaments across Ireland, join with a code, create private events, and climb the national rankings. Dublin, Cork, Galway, Limerick, Belfast & Waterford.'
/** Official logo-only share image for Google / social (not the in-app header mark). */
const DEFAULT_IMAGE = `${SITE}/images/student-padel-ireland-og.jpg`

export type PageSeo = {
  title?: string
  description?: string
  path?: string
  image?: string
  noIndex?: boolean
  type?: 'website' | 'article' | 'profile'
  /** When false, skip applying meta (used by the router fallback). */
  enabled?: boolean
  publishedTime?: string
  modifiedTime?: string
}

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
}

/** Update document title + social meta for the current route (SPA). */
export function usePageSeo({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  path = '/',
  image = DEFAULT_IMAGE,
  noIndex = false,
  type = 'website',
  enabled = true,
  publishedTime,
  modifiedTime,
}: PageSeo = {}) {
  useEffect(() => {
    if (!enabled) return

    const url = `${SITE}${path.startsWith('/') ? path : `/${path}`}`
    const fullTitle = title.includes('Student Padel Ireland')
      ? title
      : `${title} | Student Padel Ireland`

    document.title = fullTitle

    setMeta('name', 'description', description)
    setMeta('name', 'robots', noIndex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large')
    setLink('canonical', url)

    setMeta('property', 'og:title', fullTitle)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:url', url)
    setMeta('property', 'og:image', image)
    setMeta('property', 'og:type', type)

    if (publishedTime) setMeta('property', 'article:published_time', publishedTime)
    if (modifiedTime) setMeta('property', 'article:modified_time', modifiedTime)

    setMeta('name', 'twitter:title', fullTitle)
    setMeta('name', 'twitter:description', description)
    setMeta('name', 'twitter:image', image)
  }, [title, description, path, image, noIndex, type, enabled, publishedTime, modifiedTime])
}
