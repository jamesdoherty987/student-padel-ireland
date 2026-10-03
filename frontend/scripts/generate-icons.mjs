import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'public', 'icons')
const source = join(process.cwd(), 'assets', 'icon-only.png')
const background = '#0d623e'
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

for (const [name, size, scale] of [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.8],
  ['apple-touch-icon.png', 180, 1],
]) {
  writeFileSync(join(dir, name), await render(size, scale))
}

writeFileSync(join(process.cwd(), 'public', 'apple-touch-icon.png'), await render(180))

console.log('PWA icons written to public/icons and apple-touch-icon.png')
