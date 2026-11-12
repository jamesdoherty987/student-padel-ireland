import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const publicDir = join(process.cwd(), 'public')
const dir = join(publicDir, 'icons')
/** Full brand square (green bg + yellow mark) - best for favicons / Google. */
const branded = join(process.cwd(), 'assets', 'icon.png')
/** Logo mark only - composited onto green for PWA / maskable. */
const source = join(process.cwd(), 'assets', 'icon-only.png')
const background = '#0b3d2e'
mkdirSync(dir, { recursive: true })

async function render(size, scale = 1) {
  const iconSize = Math.round(size * scale)
  const icon = await sharp(source)
    .resize(iconSize, iconSize, { fit: 'contain', background })
    .png()
    .toBuffer()

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background,
    },
  })
    .composite([{ input: icon, gravity: 'centre' }])
    .png()
    .toBuffer()
}

async function faviconPng(size) {
  return sharp(branded)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toBuffer()
}

for (const [name, size, scale] of [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.8],
  ['apple-touch-icon.png', 180, 1],
]) {
  writeFileSync(join(dir, name), await render(size, scale))
}

writeFileSync(join(publicDir, 'apple-touch-icon.png'), await render(180))

// Browser tab + Google Search (Google wants a multiple of 48px, square, crawlable)
for (const size of [32, 48, 96, 192]) {
  writeFileSync(join(publicDir, `favicon-${size}.png`), await faviconPng(size))
}

// favicon.ico as 48px PNG bytes - Chrome/Safari/Edge accept this; Google uses the PNG links
writeFileSync(join(publicDir, 'favicon.ico'), await faviconPng(48))

console.log('PWA icons + favicons written to public/ and public/icons/')
