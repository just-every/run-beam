// Bounded Office ZIP/XML reading. No filesystem paths, DTDs or remote resources.
import { crc32, inflateRawSync } from 'node:zlib'
import { insist } from './core'

export interface XmlNode { name: string; attrs: Record<string, string>; children: (XmlNode | string)[] }
export const localName = (name: string) => name.split(':').at(-1)!
export const elements = (node: XmlNode) => node.children.filter((item): item is XmlNode => typeof item !== 'string')
export const children = (node: XmlNode, name: string) => elements(node).filter(item => localName(item.name) === name)
export const child = (node: XmlNode | undefined, name: string) => node && children(node, name)[0]
export const attribute = (node: XmlNode | undefined, name: string) => node && Object.entries(node.attrs).find(([key]) => localName(key) === name)?.[1]
export function descendants(node: XmlNode, name: string): XmlNode[] {
  return elements(node).flatMap(item => localName(item.name) === name ? [item] : descendants(item, name))
}
function decode(text: string) {
  insist(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(text), 'document_invalid_xml', 422)
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (_, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (named[entity]) return named[entity]
    const point = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    insist(point === 9 || point === 10 || point === 13 || point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff), 'document_invalid_xml', 422)
    return String.fromCodePoint(point)
  })
}
export function readXml(text: string): XmlNode {
  insist(text.length <= 2_000_000, 'document_xml_size', 422)
  const root: XmlNode = { name: '', attrs: {}, children: [] }, stack = [root]
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>|[^<]+/gy
  let offset = 0, count = 0
  while (offset < text.length) {
    tokens.lastIndex = offset
    const match = tokens.exec(text)
    insist(match && match.index === offset && ++count <= 100_000, 'document_invalid_xml', 422)
    const token = match[0], parent = stack.at(-1)!
    offset = tokens.lastIndex
    if (token.startsWith('<!--') || token.startsWith('<?')) continue
    if (token.startsWith('<![CDATA[')) { parent.children.push(token.slice(9, -3)); continue }
    if (!token.startsWith('<')) { parent.children.push(decode(token)); continue }
    const name = token.match(/^<\/?([\w:.-]+)/)![1]
    if (token.startsWith('</')) {
      insist(/^<\/[\w:.-]+\s*>$/.test(token) && stack.length > 1 && parent.name === name, 'document_invalid_xml', 422)
      stack.pop(); continue
    }
    const attrs: Record<string, string> = {}
    for (const value of token.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      insist(!(value[1] in attrs), 'document_invalid_xml', 422)
      attrs[value[1]] = decode(value[2] ?? value[3])
    }
    parent.children.push({ name, attrs, children: [] })
    if (!token.endsWith('/>')) stack.push(parent.children.at(-1) as XmlNode)
    insist(stack.length <= 64, 'document_invalid_xml', 422)
  }
  insist(stack.length === 1 && elements(root).length === 1 && root.children.every(item => typeof item !== 'string' || !item.trim()), 'document_invalid_xml', 422)
  return elements(root)[0]
}
export function utf8(bytes: Uint8Array) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { insist(false, 'document_not_utf8', 422) }
}

interface Entry { flags: number; method: number; size: number; compressed: number; offset: number; crc: number }
export function officeArchive(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), entries = new Map<string, Entry>()
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break }
  insist(end >= 0 && view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0, 'document_invalid_zip', 422)
  const count = view.getUint16(end + 10, true), central = view.getUint32(end + 16, true), centralEnd = central + view.getUint32(end + 12, true)
  insist(count <= 2000 && centralEnd <= end && view.getUint16(end + 8, true) === count, 'document_invalid_zip', 422)
  let pointer = central, total = 0, expanded = 0
  for (let i = 0; i < count; i++) {
    insist(pointer + 46 <= centralEnd && view.getUint32(pointer, true) === 0x02014b50, 'document_invalid_zip', 422)
    const flags = view.getUint16(pointer + 8, true), method = view.getUint16(pointer + 10, true), compressed = view.getUint32(pointer + 20, true), size = view.getUint32(pointer + 24, true)
    const nameSize = view.getUint16(pointer + 28, true), extra = view.getUint16(pointer + 30, true), comment = view.getUint16(pointer + 32, true)
    insist(pointer + 46 + nameSize + extra + comment <= centralEnd && !(flags & 1) && (method === 0 || method === 8), 'document_invalid_zip', 422)
    const name = utf8(bytes.subarray(pointer + 46, pointer + 46 + nameSize))
    total += size
    insist(!entries.has(name) && !name.startsWith('/') && !name.includes('\\') && !name.split('/').some(part => part === '..' || part === '.') && total <= 50_000_000, 'document_invalid_zip', 422)
    entries.set(name, { flags, method, size, compressed, offset: view.getUint32(pointer + 42, true), crc: view.getUint32(pointer + 16, true) })
    pointer += 46 + nameSize + extra + comment
  }
  insist(pointer === centralEnd, 'document_invalid_zip', 422)
  const cache = new Map<string, Uint8Array>()
  function read(name: string, limit = 2_000_000) {
    const entry = entries.get(name)
    insist(entry, 'document_missing_part', 422, { part: name })
    insist(entry.size > 0 && entry.size <= limit, 'document_xml_size', 422)
    if (cache.has(name)) return cache.get(name)!
    const at = entry.offset
    insist(at + 30 <= central && view.getUint32(at, true) === 0x04034b50, 'document_invalid_zip', 422)
    const nameSize = view.getUint16(at + 26, true), start = at + 30 + nameSize + view.getUint16(at + 28, true)
    insist(view.getUint16(at + 6, true) === entry.flags && view.getUint16(at + 8, true) === entry.method && utf8(bytes.subarray(at + 30, at + 30 + nameSize)) === name && start + entry.compressed <= central, 'document_invalid_zip', 422)
    let data: Uint8Array
    try { data = entry.method === 0 ? bytes.subarray(start, start + entry.compressed) : inflateRawSync(bytes.subarray(start, start + entry.compressed), { maxOutputLength: entry.size }) }
    catch { insist(false, 'document_invalid_zip', 422) }
    expanded += data.length
    insist(data.length === entry.size && crc32(data) === entry.crc && expanded <= 50_000_000, 'document_invalid_zip', 422)
    cache.set(name, data)
    return data
  }
  return { has: (name: string) => entries.has(name), names: [...entries.keys()], read, xml: (name: string) => readXml(utf8(read(name))) }
}
export type OfficeArchive = ReturnType<typeof officeArchive>
export function relationships(archive: OfficeArchive, part: string) {
  const directory = part.slice(0, part.lastIndexOf('/') + 1), filename = part.slice(part.lastIndexOf('/') + 1), rels = `${directory}_rels/${filename}.rels`
  const result = new Map<string, { path: string; external: boolean; type: string }>()
  if (!archive.has(rels)) return result
  for (const rel of children(archive.xml(rels), 'Relationship')) {
    const id = attribute(rel, 'Id'), target = attribute(rel, 'Target'), type = attribute(rel, 'Type') ?? ''
    insist(id && target && !result.has(id), 'document_invalid_relationship', 422)
    const external = attribute(rel, 'TargetMode') === 'External'
    const path: string[] = []
    if (!external) for (const component of (target.startsWith('/') ? target.slice(1) : directory + target).split('/')) {
      if (component === '..') insist(path.pop() !== undefined, 'document_invalid_relationship', 422)
      else if (component && component !== '.') { insist(!/[\\?#:\u0000-\u001f]/.test(component), 'document_invalid_relationship', 422); path.push(component) }
    }
    result.set(id, { path: path.join('/'), external, type })
  }
  return result
}
