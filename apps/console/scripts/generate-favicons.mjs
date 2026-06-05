#!/usr/bin/env node
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC = resolve(__dirname, '../public')
const SVG_PATH = resolve(PUBLIC, 'favicon.svg')

const SIZES = [
  { size: 16,  name: 'favicon-16.png' },
  { size: 32,  name: 'favicon-32.png' },
  { size: 48,  name: 'favicon-48.png' },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
]

async function main() {
  const svg = readFileSync(SVG_PATH)

  // Rasterize all PNG sizes
  for (const { size, name } of SIZES) {
    const buf = await sharp(svg).resize(size, size).png().toBuffer()
    writeFileSync(resolve(PUBLIC, name), buf)
    console.log(`  ✓ ${name} (${size}×${size})`)
  }

  // Build ICO from 16, 32, 48 — write temp PNGs for png-to-ico (needs file paths)
  const tmp16 = resolve(PUBLIC, '.tmp-16.png')
  const tmp32 = resolve(PUBLIC, '.tmp-32.png')
  const tmp48 = resolve(PUBLIC, '.tmp-48.png')
  writeFileSync(tmp16, await sharp(svg).resize(16, 16).png().toBuffer())
  writeFileSync(tmp32, await sharp(svg).resize(32, 32).png().toBuffer())
  writeFileSync(tmp48, await sharp(svg).resize(48, 48).png().toBuffer())

  const ico = await pngToIco([tmp16, tmp32, tmp48])
  writeFileSync(resolve(PUBLIC, 'favicon.ico'), ico)
  console.log('  ✓ favicon.ico (16+32+48)')

  // Clean up temp files
  unlinkSync(tmp16)
  unlinkSync(tmp32)
  unlinkSync(tmp48)

  console.log('\nAll favicons generated.')
}

main().catch(err => { console.error(err); process.exit(1) })
