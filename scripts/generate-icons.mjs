/**
 * Generates the real application icons (build/icon.png + build/icon.ico).
 * Pure Node: rasterises the mark directly into RGBA pixels, encodes a PNG with
 * zlib and wraps a 256x256 PNG inside a valid ICO container for Windows/NSIS.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crcBuffer])
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const radius = size * 0.23
  const cx = size / 2
  const cy = size / 2
  const ringOuter = size * 0.33
  const ringInner = size * 0.265
  const dotRadius = size * 0.135

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5
      // rounded-rect signed distance
      const dx = Math.max(Math.abs(px - cx) - (size / 2 - radius), 0)
      const dy = Math.max(Math.abs(py - cy) - (size / 2 - radius), 0)
      const distance = Math.hypot(dx, dy) - radius
      const bodyAlpha = 1 - smoothstep(-1.2, 1.2, distance)
      if (bodyAlpha <= 0.001) continue

      const gradient = Math.min(1, Math.max(0, (px + py) / (size * 2)))
      let r = Math.round(11 + gradient * 6)
      let g = Math.round(20 + gradient * 10)
      let b = Math.round(31 + gradient * 16)

      const radial = Math.hypot(px - cx, py - cy)
      const ring = smoothstep(ringOuter + 1.2, ringOuter - 1.2, radial) * smoothstep(ringInner - 1.2, ringInner + 1.2, radial)
      const glow = Math.max(0, 1 - Math.abs(radial - ringOuter) / (size * 0.06)) * 0.35
      const dot = 1 - smoothstep(dotRadius - 1.4, dotRadius + 1.4, radial)
      const accent = Math.min(1, ring * 1.0 + dot * 0.95 + glow)
      r = Math.round(r * (1 - accent) + 34 * accent)
      g = Math.round(g * (1 - accent) + 188 * accent)
      b = Math.round(b * (1 - accent) + 255 * accent)

      const compare = smoothstep(0.16, 0.86, (px + py) / (size * 1.4))
      const finalR = Math.round(r * (0.92 + compare * 0.08))
      const finalG = Math.round(g * (0.92 + compare * 0.08))
      const finalB = Math.round(b * (0.95 + compare * 0.05))

      const index = (y * size + x) * 4
      rgba[index] = finalR
      rgba[index + 1] = finalG
      rgba[index + 2] = finalB
      rgba[index + 3] = Math.round(bodyAlpha * 255)
    }
  }
  return rgba
}

function buildIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + pngs.length * 16
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(entry)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((png) => png.data)])
}

mkdirSync(resolve(root, 'build'), { recursive: true })

const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((size) => ({ size, data: encodePng(size, size, renderIcon(size)) }))
writeFileSync(resolve(root, 'build/icon.ico'), buildIco(pngs))

const large = encodePng(512, 512, renderIcon(512))
writeFileSync(resolve(root, 'build/icon.png'), large)
writeFileSync(resolve(root, 'build/256x256.png'), pngs[pngs.length - 1].data)

console.log('Wrote build/icon.ico, build/icon.png and build/256x256.png')
