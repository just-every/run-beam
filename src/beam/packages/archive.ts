import { crc32, inflateRawSync } from 'node:zlib'
import { insist } from '../core'
import type { PackageFile } from './types'

const MAX_ARCHIVE = 25_000_000, MAX_FILE = 20_000_000, MAX_TOTAL = 100_000_000
const utf8 = new TextDecoder('utf-8', { fatal: true })
const invalid = (condition: unknown, feature: string) => insist(condition, 'package_invalid_zip', 422, { feature })

/** Paths have one canonical representation before they become storage/HTTP keys. */
export function packagePath(value: string, base = '', url = false): string {
  insist(value.length > 0 && value.length <= 2048 && !/[\\\x00-\x1f\x7f]/.test(value) && !/^[\s/]/.test(value) && !/^[a-z][a-z\d+.-]*:/i.test(value), 'package_unsafe_path', 422, { path: value })
  let path = value
  if (url) {
    try { path = decodeURIComponent(value) } catch { insist(false, 'package_unsafe_path', 422, { path: value }) }
  }
  insist(!/[%?#:\\\x00-\x1f\x7f]/.test(path) && !path.startsWith('/') && path.normalize('NFC') === path, 'package_unsafe_path', 422, { path: value })
  const parts = `${base}${path}`.split('/')
  insist(parts.every(part => part !== '..' && !/[. ]$/.test(part === '.' ? '' : part)), 'package_unsafe_path', 422, { path: value })
  const result = parts.filter(part => part !== '.' && part !== '').join('/')
  insist(result.length > 0 && result.length <= 2048, 'package_unsafe_path', 422, { path: value })
  return result
}

export function unpackPackage(bytes: Uint8Array): PackageFile[] {
  invalid(bytes.length >= 22 && bytes.length <= MAX_ARCHIVE, 'archive size (25 MB maximum)')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) { end = at; break }
  }
  invalid(end >= 0, 'end of central directory')
  invalid(view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0, 'multi-disk archive')
  const count = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true), length = view.getUint32(end + 12, true)
  invalid(count > 0 && count <= 3000 && count === view.getUint16(end + 8, true) && start + length === end, 'central directory or ZIP64')
  const names = new Set<string>(), spans: { start: number; end: number }[] = [], files: PackageFile[] = []
  let at = start, total = 0
  const decode = (data: Uint8Array) => { try { return utf8.decode(data) } catch { invalid(false, 'non-UTF-8 filename'); return '' } }
  const extras = (offset: number, size: number) => {
    const stop = offset + size
    while (offset < stop) {
      invalid(offset + 4 <= stop, 'malformed ZIP extra field')
      const id = view.getUint16(offset, true), length = view.getUint16(offset + 2, true)
      invalid(id !== 1 && id !== 0x7075 && offset + 4 + length <= stop, 'ZIP64 or alternate Unicode filename')
      offset += 4 + length
    }
  }
  for (let index = 0; index < count; index++) {
    invalid(at + 46 <= end && view.getUint32(at, true) === 0x02014b50, 'central directory entry')
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), checksum = view.getUint32(at + 16, true)
    const compressed = view.getUint32(at + 20, true), size = view.getUint32(at + 24, true), nameSize = view.getUint16(at + 28, true)
    const extraSize = view.getUint16(at + 30, true), commentSize = view.getUint16(at + 32, true), localAt = view.getUint32(at + 42, true)
    const next = at + 46 + nameSize + extraSize + commentSize
    invalid(next <= end && nameSize > 0 && view.getUint16(at + 34, true) === 0, 'entry size or disk')
    invalid((flags & ~0x080e) === 0 && (method === 0 || method === 8), 'encryption, flags or compression method')
    invalid(method === 8 || !(flags & 6), 'compression flags')
    extras(at + 46 + nameSize, extraSize)
    const name = decode(bytes.subarray(at + 46, at + 46 + nameSize)), directory = name.endsWith('/')
    const path = packagePath(directory ? name.slice(0, -1) : name)
    invalid(name === `${path}${directory ? '/' : ''}` && !names.has(path.toLowerCase()), 'duplicate or noncanonical filename')
    names.add(path.toLowerCase())
    const mode = view.getUint32(at + 38, true) >>> 16, kind = mode & 0xf000
    invalid(kind === 0 || kind === 0x8000 && !directory || kind === 0x4000 && directory, 'symlink or special file')
    total += size
    invalid(size <= MAX_FILE && total <= MAX_TOTAL && size <= Math.max(1_000_000, compressed * 1000), 'expanded size or compression ratio')
    invalid(!directory || size === 0, 'directory with content')
    invalid(localAt + 30 <= start && view.getUint32(localAt, true) === 0x04034b50, 'local file header')
    const localNameSize = view.getUint16(localAt + 26, true), localExtraSize = view.getUint16(localAt + 28, true)
    const dataAt = localAt + 30 + localNameSize + localExtraSize, dataEnd = dataAt + compressed
    invalid(dataEnd <= start && view.getUint16(localAt + 6, true) === flags && view.getUint16(localAt + 8, true) === method, 'local header mismatch')
    invalid(decode(bytes.subarray(localAt + 30, localAt + 30 + localNameSize)) === name, 'local filename mismatch')
    extras(localAt + 30 + localNameSize, localExtraSize)
    let spanEnd = dataEnd
    if (flags & 8) {
      if (spanEnd + 4 <= start && view.getUint32(spanEnd, true) === 0x08074b50) spanEnd += 4
      invalid(spanEnd + 12 <= start && view.getUint32(spanEnd, true) === checksum && view.getUint32(spanEnd + 4, true) === compressed && view.getUint32(spanEnd + 8, true) === size, 'data descriptor mismatch')
      spanEnd += 12
    } else invalid(view.getUint32(localAt + 14, true) === checksum && view.getUint32(localAt + 18, true) === compressed && view.getUint32(localAt + 22, true) === size, 'local size or CRC mismatch')
    spans.push({ start: localAt, end: spanEnd })
    let output: Uint8Array
    if (method === 0) output = bytes.slice(dataAt, dataEnd)
    else {
      try {
        const result = inflateRawSync(bytes.subarray(dataAt, dataEnd), { maxOutputLength: Math.max(1, size), info: true }) as unknown as { buffer: Uint8Array; engine: { bytesWritten: number } }
        invalid(result.engine.bytesWritten === compressed, 'trailing compressed data')
        output = result.buffer
      } catch { invalid(false, 'invalid deflate content'); throw new Error('unreachable') }
    }
    invalid(output.length === size && crc32(output) === checksum, 'expanded size or CRC mismatch')
    if (!directory) files.push({ path, bytes: output })
    at = next
  }
  invalid(at === end, 'trailing central directory data')
  spans.sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const span of spans) { invalid(span.start === cursor, 'overlapping entries or unlisted ZIP data'); cursor = span.end }
  invalid(cursor === start, 'unlisted ZIP data')
  const fileNames = new Set(files.map(file => file.path.toLowerCase()))
  for (const file of files) {
    const parts = file.path.split('/')
    for (let count = 1; count < parts.length; count++) invalid(!fileNames.has(parts.slice(0, count).join('/').toLowerCase()), 'file/directory collision')
  }
  return files
}
