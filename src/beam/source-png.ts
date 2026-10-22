// Encode bounded PDF raster samples without a native canvas or image service.
import { crc32, deflateSync } from 'node:zlib'
import { insist } from './core'
function chunk(name: string, data: Uint8Array) {
  const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(name), 4); out.set(data, 8)
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)))
  return out
}
export function pdfRasterPng(width: number, height: number, channels: number, samples: Uint8Array | Uint8ClampedArray) {
  insist(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0 && width * height <= 4_000_000 && [1, 3, 4].includes(channels) && samples.length === width * height * channels, 'document_image_limit', 422)
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, width); view.setUint32(4, height)
  header[8] = 8; header[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6
  const stride = width * channels, rows = new Uint8Array((stride + 1) * height)
  for (let row = 0; row < height; row++) rows.set(samples.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1)
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', new Uint8Array())]
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}
