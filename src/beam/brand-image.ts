// Bounded raster decoding for certificate logos; uploaded images never supply PDF syntax.
import { deflateSync, inflateSync } from 'node:zlib'
import { insist } from './core'
export interface BrandImage { width: number; height: number; data: Uint8Array; filter: 'FlateDecode' | 'DCTDecode'; colors: number }
export function brandImage(bytes: Uint8Array): BrandImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const bounded = (width: number, height: number) => insist(width > 0 && height > 0 && width <= 2048 && height <= 2048 && width * height <= 1000000, 'theme_image_dimensions')
  if (bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 9 < bytes.length;) {
      insist(bytes[offset++] === 255, 'theme_image_type')
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++], length = view.getUint16(offset)
      insist(length >= 2 && offset + length <= bytes.length, 'theme_image_type')
      if ([192, 193, 194].includes(marker)) {
        const height = view.getUint16(offset + 3), width = view.getUint16(offset + 5), colors = bytes[offset + 7]
        bounded(width, height)
        insist(bytes[offset + 2] === 8 && [1, 3].includes(colors), 'theme_image_type')
        return { width, height, colors, data: bytes, filter: 'DCTDecode' }
      }
      offset += length
    }
    insist(false, 'theme_image_type')
  }
  insist(bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value), 'theme_image_type')
  let width = 0, height = 0, channels = 0, kind = 0, ended = false, palette: Uint8Array | undefined, alpha: Uint8Array | undefined
  const chunks: Uint8Array[] = []
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset), name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    insist(length <= bytes.length - offset - 12, 'theme_image_type')
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (name === 'IHDR') {
      insist(offset === 8 && length === 13, 'theme_image_type')
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12); kind = data[9]
      bounded(width, height)
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[kind]
      insist(data[8] === 8 && channels && data[10] === 0 && data[11] === 0 && data[12] === 0, 'theme_image_type')
    } else if (name === 'PLTE') palette = data
    else if (name === 'tRNS') alpha = data
    else if (name === 'IDAT') chunks.push(data)
    else if (name === 'IEND') { ended = true; break }
    offset += length + 12
  }
  insist(ended && channels && chunks.length && (kind !== 3 || palette && palette.length % 3 === 0), 'theme_image_type')
  const compressed = new Uint8Array(chunks.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of chunks) { compressed.set(part, offset); offset += part.length }
  const stride = width * channels, expected = (stride + 1) * height
  let raw: Uint8Array
  try { raw = inflateSync(compressed, { maxOutputLength: expected }) } catch { insist(false, 'theme_image_type') }
  insist(raw.length === expected, 'theme_image_type')
  const decoded = new Uint8Array(stride * height), rgb = new Uint8Array(width * height * 3)
  const paeth = (a: number, b: number, c: number) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    insist(filter <= 4, 'theme_image_type')
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x, a = x >= channels ? decoded[index - channels] : 0, b = y ? decoded[index - stride] : 0, c = y && x >= channels ? decoded[index - stride - channels] : 0
      decoded[index] = raw[y * (stride + 1) + x + 1] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]
    }
    for (let x = 0; x < width; x++) {
      const at = y * stride + x * channels, pixel = (y * width + x) * 3
      let colors: number[], opacity = 255
      if (kind === 3) { const index = decoded[at]; insist(palette && index * 3 + 2 < palette.length, 'theme_image_type'); colors = [...palette.subarray(index * 3, index * 3 + 3)]; opacity = alpha?.[index] ?? 255 }
      else if (kind === 0 || kind === 4) { colors = [decoded[at], decoded[at], decoded[at]]; opacity = kind === 4 ? decoded[at + 1] : 255 }
      else { colors = [...decoded.subarray(at, at + 3)]; opacity = kind === 6 ? decoded[at + 3] : 255 }
      for (let channel = 0; channel < 3; channel++) rgb[pixel + channel] = Math.round((colors[channel] * opacity + 255 * (255 - opacity)) / 255)
    }
  }
  return { width, height, colors: 3, data: deflateSync(rgb), filter: 'FlateDecode' }
}
