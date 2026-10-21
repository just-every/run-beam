// AUTHOR-002: bounded, inert extraction. Original bytes remain the authority;
// unsupported formatting and image/OCR work are disclosed, never fabricated.
import { crc32, inflateRawSync } from 'node:zlib'
import { insist } from './core'

const XML_LIMIT = 2_000_000
interface Node { name: string; attrs: Record<string, string>; children: (Node | string)[] }
const local = (name: string) => name.split(':').at(-1)!
const nodes = (node: Node) => node.children.filter((child): child is Node => typeof child !== 'string')
const child = (node: Node, name: string) => nodes(node).find(item => local(item.name) === name)
const attr = (node: Node | undefined, name: string) => node && Object.entries(node.attrs).find(([key]) => local(key) === name)?.[1]
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
function xml(text: string): Node {
  // No DTD/entity declarations, external resources or instruction evaluation.
  const root: Node = { name: '', attrs: {}, children: [] }, stack = [root]
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
    const node: Node = { name, attrs, children: [] }
    parent.children.push(node)
    if (!token.endsWith('/>')) stack.push(node)
    insist(stack.length <= 64, 'document_invalid_xml', 422)
  }
  insist(stack.length === 1 && nodes(root).length === 1 && root.children.every(item => typeof item !== 'string' || !item.trim()), 'document_invalid_xml', 422)
  return nodes(root)[0]
}

function documentXml(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break }
  insist(end >= 0 && view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0, 'document_invalid_zip', 422)
  const count = view.getUint16(end + 10, true), centralEnd = view.getUint32(end + 16, true) + view.getUint32(end + 12, true)
  insist(count <= 2000 && centralEnd <= end && view.getUint16(end + 8, true) === count, 'document_invalid_zip', 422)
  let pointer = view.getUint32(end + 16, true), total = 0, result: Uint8Array | undefined
  const names = new Set<string>()
  for (let i = 0; i < count; i++) {
    insist(pointer + 46 <= centralEnd && view.getUint32(pointer, true) === 0x02014b50, 'document_invalid_zip', 422)
    const flags = view.getUint16(pointer + 8, true), method = view.getUint16(pointer + 10, true), compressed = view.getUint32(pointer + 20, true), size = view.getUint32(pointer + 24, true)
    const nameSize = view.getUint16(pointer + 28, true), extra = view.getUint16(pointer + 30, true), comment = view.getUint16(pointer + 32, true), at = view.getUint32(pointer + 42, true)
    insist(pointer + 46 + nameSize + extra + comment <= centralEnd && !(flags & 1) && (method === 0 || method === 8), 'document_invalid_zip', 422)
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(pointer + 46, pointer + 46 + nameSize))
    total += size
    insist(!names.has(name) && total <= 50_000_000, 'document_invalid_zip', 422)
    names.add(name)
    if (name === 'word/document.xml') {
      insist(size > 0 && size <= XML_LIMIT && at + 30 <= end && view.getUint32(at, true) === 0x04034b50, 'document_xml_size', 422)
      const localNameSize = view.getUint16(at + 26, true)
      const start = at + 30 + localNameSize + view.getUint16(at + 28, true)
      insist(view.getUint16(at + 6, true) === flags && view.getUint16(at + 8, true) === method && new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + localNameSize)) === name, 'document_invalid_zip', 422)
      insist(start + compressed <= view.getUint32(end + 16, true), 'document_invalid_zip', 422)
      const data = bytes.subarray(start, start + compressed)
      if (method === 0) result = data
      else {
        try { result = (inflateRawSync(data, { maxOutputLength: size, info: true }) as unknown as { buffer: Uint8Array }).buffer }
        catch { insist(false, 'document_invalid_zip', 422) }
      }
      insist(result!.length === size, 'document_xml_size', 422)
      insist(crc32(result!) === view.getUint32(pointer + 16, true), 'document_invalid_zip', 422)
    }
    pointer += 46 + nameSize + extra + comment
  }
  insist(pointer === centralEnd && result, 'document_no_word_body', 422)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(result) } catch { insist(false, 'document_not_utf8', 422) }
}

export interface ExtractedLesson { title: string; body: string }
export function extractDocument(bytes: Uint8Array, filename: string, title: string) {
  const lessons: ExtractedLesson[] = [], warnings = new Set<string>()
  let current: ExtractedLesson = { title, body: '' }
  const flush = () => { if (current.body.trim()) lessons.push({ title: current.title, body: current.body.trim() }) }
  const add = (text: string, heading = false) => {
    if (!text.trim()) return
    if (heading) { flush(); current = { title: text.trim(), body: '' } }
    else current.body += `${current.body ? '\n\n' : ''}${text}`
    insist(current.body.length <= 50_000 && current.title.length <= 160 && lessons.length < 60, 'document_lesson_limit', 422)
  }
  if (/\.docx$/i.test(filename)) {
    const document = xml(documentXml(bytes)), body = child(document, 'body')
    insist(local(document.name) === 'document' && body, 'document_no_word_body', 422)
    warnings.add('DOCX extraction preserves paragraph text, recognized headings and table cell text. Check lists, merged cells, formatting, headers, footnotes and omitted objects against the original.')
    const text = (node: Node): string => {
      const name = local(node.name)
      if (name === 't') return node.children.filter(item => typeof item === 'string').join('')
      if (name === 'tab') return '\t'
      if (name === 'br' || name === 'cr') return '\n'
      if (name === 'del' || name === 'moveFrom') { warnings.add('Deleted or moved-from tracked text was omitted; resolve tracked changes against the original.'); return '' }
      if (name === 'docPr') {
        warnings.add('Image bytes are not converted into lessons. Check each description and the original image before using this material.')
        return `[Image: ${attr(node, 'descr') || attr(node, 'title') || 'description missing; inspect the original'}]`
      }
      return nodes(node).map(text).join('')
    }
    for (const node of nodes(body)) {
      const name = local(node.name)
      if (name === 'p') {
        const properties = child(node, 'pPr'), style = attr(properties && child(properties, 'pStyle'), 'val') ?? ''
        add(text(node), /^(?:heading[1-9]|title)$/i.test(style) || !!(properties && child(properties, 'outlineLvl') && Number(attr(child(properties, 'outlineLvl'), 'val')) < 9))
      } else if (name === 'tbl') {
        const rows = nodes(node).filter(item => local(item.name) === 'tr').map(row => nodes(row).filter(item => local(item.name) === 'tc').map(cell => nodes(cell).filter(item => local(item.name) === 'p').map(text).join(' / ')).join('\t'))
        add(rows.join('\n'))
      } else if (name !== 'sectPr') warnings.add('An unsupported document block was omitted; inspect the original before preparing lessons.')
    }
  } else {
    insist(/\.(txt|md|markdown)$/i.test(filename), 'source_extraction_unsupported', 422, { supported: ['txt', 'md', 'docx'], pending: ['pdf', 'pptx', 'html', 'ocr'] })
    insist(bytes.length <= 1_000_000, 'document_text_size', 422)
    let value: string
    try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { insist(false, 'document_not_utf8', 422) }
    insist(!/[\x00-\x08\x0e-\x1f]/.test(value), 'document_not_text', 422)
    warnings.add('Text extraction recognizes Markdown-style headings only. Other markup stays literal text; check structure against the original.')
    for (const line of value.replace(/\r\n?/g, '\n').split('\n')) {
      const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/)
      if (heading) add(heading[1], true)
      else { current.body += `${current.body ? '\n' : ''}${line}`; insist(current.body.length <= 50_000, 'document_lesson_limit', 422) }
    }
  }
  flush()
  insist(lessons.length > 0 && lessons.length <= 60, 'document_no_lessons', 422)
  return { lessons, warnings: [...warnings], reviewRequired: true as const }
}
