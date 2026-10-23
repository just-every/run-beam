// HTML is parsed as inert data, never placed in the page or fetched remotely.
import { parse } from 'parse5'
import { insist } from './core'
import { utf8 } from './source-archive'
import { SourceContent, type SourceCell } from './source-content'
import { MAX_TABLE_CELLS, MAX_TABLE_DEPTH } from './lesson-tables'

interface HtmlNode { nodeName: string; tagName?: string; value?: string; attrs?: { name: string; value: string }[]; childNodes?: HtmlNode[] }
export type HtmlImageResolver = (source: string) => { bytes: Uint8Array; filename: string } | undefined
const blocked = new Set(['head', 'script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'select', 'textarea', 'canvas', 'svg', 'math'])
const attr = (node: HtmlNode, name: string) => node.attrs?.find(item => item.name === name)?.value ?? ''
const kids = (node: HtmlNode) => node.childNodes ?? []
function text(node: HtmlNode, cellText = false): string {
  if (blocked.has(node.tagName ?? '') || cellText && node.tagName === 'table') return ''
  if (node.nodeName === '#text') return node.value ?? ''
  if (node.tagName === 'br') return '\n'
  const value = kids(node).map(child => text(child, cellText)).join('')
  return cellText && ['p', 'div', 'li'].includes(node.tagName ?? '') ? `${value}\n` : value
}
function inner(node: HtmlNode, cellText = false) { return text(node, cellText).replace(/[\t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim() }
function find(node: HtmlNode, name: string, throughTables = false): HtmlNode[] {
  return kids(node).flatMap(item => item.tagName === name ? [item] : (!throughTables && item.tagName === 'table' || blocked.has(item.tagName ?? '')) ? [] : find(item, name, throughTables))
}
function image(node: HtmlNode, content: SourceContent, location: string, resolve?: HtmlImageResolver) {
  const source = attr(node, 'src'), alt = attr(node, 'alt') || attr(node, 'title')
  const embedded = source.match(/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/i)
  if (embedded) {
    let bytes: Uint8Array
    try { bytes = Uint8Array.from(atob(embedded[2]), character => character.charCodeAt(0)) } catch { insist(false, 'document_invalid_image', 422) }
    content.image(bytes, `image.${embedded[1].toLowerCase()}`, alt, location)
  } else {
    const resource = resolve?.(source)
    if (resource) content.image(resource.bytes, resource.filename, alt, location)
    else {
      content.warnings.add(resolve
        ? 'Remote and unavailable relative HTML images were not fetched. Upload a licensed local image before using that image in a lesson.'
        : 'Remote and relative HTML images were not fetched. Upload a licensed local image before using that image in a lesson.')
      content.image(undefined, 'image', alt, location)
    }
  }
}
function htmlGrid(node: HtmlNode, depth = 1, budget = { cells: 0 }): { text: string; table: SourceCell[][] } {
  const rows = find(node, 'tr')
  insist(depth <= MAX_TABLE_DEPTH && rows.length > 0 && rows.length <= 100, 'document_table_limit', 422)
  const table = rows.map(row => {
    const cells = kids(row).filter(cell => ['td', 'th'].includes(cell.tagName ?? ''))
    insist(cells.length <= 30, 'document_table_limit', 422)
    return cells.map(cell => {
      insist(++budget.cells <= MAX_TABLE_CELLS, 'document_table_limit', 422)
      const nested = find(cell, 'table')
      return { text: inner(cell, true), colSpan: Number(attr(cell, 'colspan') || 1), rowSpan: Number(attr(cell, 'rowspan') || 1), header: cell.tagName === 'th',
        ...(nested.length ? { tables: nested.map(table => htmlGrid(table, depth + 1, budget)) } : {}) }
    })
  })
  return { text: find(node, 'caption').map(caption => inner(caption)).join(' ') || 'Procedure table', table }
}
function htmlTable(node: HtmlNode, content: SourceContent, location: string, resolve?: HtmlImageResolver) {
  const grid = htmlGrid(node)
  content.table(grid.table, location, grid.text)
  // Traverse the untouched complete tree once: nested images are neither lost nor extracted twice.
  for (const img of find(node, 'img', true)) image(img, content, location, resolve)
}
export function extractHtml(bytes: Uint8Array, content: SourceContent, resolve?: HtmlImageResolver) {
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
    if (tag === 'table') { htmlTable(node, content, location, resolve); return }
    if (tag === 'img') { image(node, content, location, resolve); return }
    if (['p', 'li', 'pre', 'blockquote', 'figcaption', 'dt', 'dd'].includes(tag)) {
      const value = inner(node)
      if (value) content.text(tag === 'li' ? `- ${value}` : value, location)
      for (const img of find(node, 'img')) image(img, content, location, resolve)
      return
    }
    if (node.nodeName === '#text') { if (node.value?.trim()) content.text(node.value.trim(), location); return }
    for (const item of kids(node)) visit(item)
  }
  visit(root)
}
