import { refuseErasedIdentity } from './erasure-fence'
// Content-addressed file custody in the FILES bucket. Bytes are verified after
// writing and on every read. Uploaded content is data: it is never rendered as
// HTML or script, and only recognised media types are shown inline.
import type { Bindings } from '../auth.server'
import { insist, sha256Hex } from './core'

export interface Stored { filename: string; mediaType: string; size: number; sha256: string }

const INLINE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'text/plain'])

export function sniff(bytes: Uint8Array): string {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  if (ascii(0, 5) === '%PDF-') return 'application/pdf'
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (ascii(4, 8) === 'ftyp') return 'video/mp4'
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm'
  if (ascii(0, 3) === 'ID3') return 'audio/mpeg'
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'application/zip'
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, 65_536))
    if (!/[\x00-\x08\x0e-\x1f]/.test(text)) return 'text/plain'
  } catch {}
  return 'application/octet-stream'
}

export async function store(env: Bindings, file: { filename: string; bytes: Uint8Array }): Promise<Stored> {
  const sha256 = await sha256Hex(file.bytes)
  await refuseErasedIdentity(env, [`file:${sha256}`])
  const mediaType = sniff(file.bytes)
  const key = `sha256/${sha256}`
  if (!await env.FILES.head(key)) await env.FILES.put(key, file.bytes, { httpMetadata: { contentType: 'application/octet-stream' } })
  const check = await env.FILES.get(key)
  insist(check && check.size === file.bytes.length && await sha256Hex(new Uint8Array(await check.arrayBuffer())) === sha256, 'storage_verification_failed', 503)
  return { filename: file.filename, mediaType, size: file.bytes.length, sha256 }
}

export async function serve(env: Bindings, file: Stored, { download = false } = {}): Promise<Response> {
  const object = await env.FILES.get(`sha256/${file.sha256}`)
  insist(object, 'file_missing', 503)
  const bytes = new Uint8Array(await object.arrayBuffer())
  insist(bytes.length === file.size && await sha256Hex(bytes) === file.sha256, 'file_integrity', 503)
  const inline = !download && INLINE.has(file.mediaType)
  return new Response(bytes, {
    headers: {
      'content-type': inline ? (file.mediaType === 'text/plain' ? 'text/plain; charset=utf-8' : file.mediaType) : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; media-src 'self'",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  })
}
