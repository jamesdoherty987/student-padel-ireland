import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'public', 'icons')
mkdirSync(dir, { recursive: true })

function svg(size, { radius = Math.round(size * 0.22), maskable = false } = {}) {
  const pad = maskable ? Math.round(size * 0.18) : Math.round(size * 0.12)
  const inner = size - pad * 2
  const cx = size / 2
  const cy = size / 2
  const ballR = inner * 0.16
  const stroke = Math.max(2, Math.round(size * 0.03))
  const lineInset = pad + inner * 0.12
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="#0b3d2e"/>
  <circle cx="${cx}" cy="${cy}" r="${ballR}" fill="#c8e600"/>
  <path d="M${lineInset} ${cy - inner * 0.22}h${inner * 0.76}M${lineInset} ${cy + inner * 0.22}h${inner * 0.76}M${cx - inner * 0.22} ${lineInset}v${inner * 0.76}M${cx + inner * 0.22} ${lineInset}v${inner * 0.76}" stroke="#1a6b4f" stroke-width="${stroke}" stroke-linecap="round"/>
</svg>`
}

const jobs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
]

for (const [name, size, maskable] of jobs) {
  const buf = await sharp(
    Buffer.from(svg(size, { maskable, radius: maskable ? 0 : Math.round(size * 0.22) })),
  )
    .png()
    .toBuffer()
  writeFileSync(join(dir, name), buf)
}

writeFileSync(
  join(process.cwd(), 'public', 'apple-touch-icon.png'),
  await sharp(Buffer.from(svg(180))).png().toBuffer(),
)

console.log('PWA icons written to public/icons and apple-touch-icon.png')
