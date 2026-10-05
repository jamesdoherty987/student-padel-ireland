/**
 * Landing media in /public/images and /public/videos
 */
export const LANDING_IMAGES = {
  /** First frame / fallback */
  hero: '/images/heroes/hero-03.webp',
  /** Poster for feature video */
  feature: '/images/gallery-1.jpg',
}

/**
 * Rotating hero backgrounds — lightest first so LCP is not a 500KB+ image.
 * Heavier frames (hero-04/05) are omitted to keep mobile downloads smaller.
 */
export const HERO_ROTATION = [
  '/images/heroes/hero-03.webp',
  '/images/heroes/hero-02.webp',
] as const

/** How-it-works feature video */
export const LANDING_VIDEO = {
  poster: '/images/gallery-1.jpg',
  mp4: '/videos/feature.mp4',
}
