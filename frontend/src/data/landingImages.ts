/**
 * Landing media in /public/images and /public/videos
 */
export const LANDING_IMAGES = {
  /** First frame / fallback */
  hero: '/images/heroes/hero-01.jpeg',
  /** Poster for feature video */
  feature: '/images/gallery-1.jpg',
}

/** Rotating hero backgrounds */
export const HERO_ROTATION = [
  '/images/heroes/hero-01.jpeg',
  '/images/heroes/hero-02.webp',
  '/images/heroes/hero-03.webp',
  '/images/heroes/hero-04.jpg',
  '/images/heroes/hero-05.webp',
] as const

/** How-it-works feature video */
export const LANDING_VIDEO = {
  poster: '/images/gallery-1.jpg',
  mp4: '/videos/feature.mp4',
}
