// HTML is parsed as inert data, never placed in the page or fetched remotely.
import { parse } from 'parse5'
import { insist } from './core'
import { utf8 } from './source-archive'
import { SourceContent, type SourceCell } from './source-content'

interface HtmlNode { nodeName: string; tagName?: string; value?: string; attrs?: { name: string; value: string }[]; childNodes?: HtmlNode[] }
const blocked = new Set(['head', 'script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'select', 'textarea', 'canvas', 'svg', 'math'])
const attr = (node: HtmlNode, name: string) => node.attrs?.find(item => item.name === name)?.value ?? ''
const kids = (node: HtmlNode) => node.childNodes ?? []
function text(node: HtmlNode): string {
  if (blocked.has(node.tagName ?? '')) return ''
  if (node.nodeName === '#text') return node.value ?? ''
  if (node.tagName === 'br') return '\n'
  return kids(node).map(text).join('')
}
function inner(node: HtmlNode) { return text(node).replace(/[\t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim() }
function find(node: HtmlNode, name: string): HtmlNode[] {
  return kids(node).flatMap(item => item.tagName === name ? [item] : item.tagName === 'table' || blocked.has(item.tagName ?? '') ? [] : find(item, name))
}
function image(node: HtmlNode, content: SourceContent, location: string) {
  const source = attr(node, 'src'), alt = attr(node, 'alt') || attr(node, 'title')
  const embedded = source.match(/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/i)
  if (embedded) {
    let bytes: Uint8Array
    try { bytes = Uint8Array.from(atob(embedded[2]), character => character.charCodeAt(0)) } catch { insist(false, 'document_invalid_image', 422) }
    content.image(bytes, `image.${embedded[1].toLowerCase()}`, alt, location)
  } else {
    content.warnings.add('Remote and relative HTML images were not fetched. Upload a licensed local image before using that image in a lesson.')
    content.image(undefined, 'image', alt, location)
  }
}
function htmlTable(node: HtmlNode, content: SourceContent, location: string) {
  const rows: SourceCell[][] = find(node, 'tr').map(row => kids(row).filter(cell => ['td', 'th'].includes(cell.tagName ?? '')).map(cell => ({ text: inner(cell), colSpan: Number(attr(cell, 'colspan') || 1), rowSpan: Number(attr(cell, 'rowspan') || 1), header: cell.tagName === 'th' })))
  content.table(rows, location, find(node, 'caption').map(inner).join(' ') || 'Procedure table')
  for (const img of find(node, 'img')) image(img, content, location)
  if (find(node, 'table').length) content.warnings.add('A nested HTML table was reduced to its enclosing cell text. Inspect its structure against the original.')
}
export function extractHtml(bytes: Uint8Array, content: SourceContent) {
  insist(bytes.length <= 1_000_000, 'document_text_size', 422)
  const root = parse(utf8(bytes)) as unknown as HtmlNode
  let count = 0
  const pending = [{ node: root, depth: 0 }]
  while (pending.length) {
    const { node, depth } = pending.pop()!
    insist(++count <= 100_000 && depth <= 64, 'document_html_limit', 422)
    pending.push(...kids(node).map(item => ({ node: item, depth: depth + 1 })))
  }
  content.warnings.add('HTML headings, text, tables and embedded raster images are extracted without running code. Check CSS-dependent reading order, hidden content, layout and omitted interactive objects against the original.')
  let position = 0
  function visit(node: HtmlNode) {
    const tag = node.tagName ?? '', location = `HTML block ${++position}`
    if (blocked.has(tag) || attr(node, 'hidden') !== '' || node.attrs?.some(item => item.name === 'hidden') || attr(node, 'aria-hidden') === 'true') return
    if (/^h[1-6]$/.test(tag)) { const value = inner(node); if (value) content.heading(value, location); return }
    if (tag === 'table') { htmlTable(node, content, location); return }
    if (tag === 'img') { image(node, content, location); return }
    if (['p', 'li', 'pre', 'blockquote', 'figcaption', 'dt', 'dd'].includes(tag)) {
      const value = inner(node)
      if (value) content.text(tag === 'li' ? `- ${value}` : value, location)
      for (const img of find(node, 'img')) image(img, content, location)
      return
    }
    if (node.nodeName === '#text') { if (node.value?.trim()) content.text(node.value.trim(), location); return }
    for (const item of kids(node)) visit(item)
  }
  visit(root)
}
