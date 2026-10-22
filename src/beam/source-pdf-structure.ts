// Tagged PDFs carry authored reading order, heading and table semantics.
// Use those only when every extracted text run is accounted for; otherwise the
// page remains a plain-text extraction with an explicit layout warning.
import { insist } from './core'
import type { SourceCell } from './source-content'
interface Structure { role?: string; type?: string; id?: string; children?: Structure[] }
interface TextRun { str?: string; hasEOL?: boolean; type?: string; id?: string }
type Part = { kind: 'heading' | 'text'; text: string } | { kind: 'table'; table: SourceCell[][] }
const normalize = (value: string) => value.replace(/\s/g, '')
export function taggedPdfContent(tree: unknown, runs: TextRun[]): Part[] | null {
  if (!tree) return null
  const mapped = new Map<string, string>(), stack: string[] = []
  let raw = '', nodes = 0
  for (const run of runs) {
    if (typeof run.str === 'string') {
      const value = run.str + (run.hasEOL ? '\n' : ' ')
      raw += value
      const id = stack.at(-1)
      if (id) mapped.set(id, (mapped.get(id) ?? '') + value)
    } else if (run.type === 'beginMarkedContent' || run.type === 'beginMarkedContentProps') stack.push(run.id ?? '')
    else if (run.type === 'endMarkedContent') stack.pop()
  }
  const root = tree as Structure
  function text(node: Structure, depth = 0): string {
    insist(++nodes <= 20_000 && depth <= 64, 'document_pdf_structure_limit', 422)
    return node.type === 'content' ? mapped.get(node.id ?? '') ?? '' : (node.children ?? []).map(item => text(item, depth + 1)).join(' ')
  }
  if (normalize(text(root)) !== normalize(raw)) return null
  const parts: Part[] = []
  function rows(node: Structure): Structure[] {
    return (node.children ?? []).flatMap(item => item.role === 'TR' ? [item] : rows(item))
  }
  function visit(node: Structure) {
    if (/^H[1-6]?$/.test(node.role ?? '')) { const value = text(node).trim(); if (value) parts.push({ kind: 'heading', text: value }); return }
    if (node.role === 'Table') {
      const table = rows(node).map(row => (row.children ?? []).filter(cell => cell.role === 'TH' || cell.role === 'TD').map(cell => ({ text: text(cell).trim(), colSpan: 1, rowSpan: 1, header: cell.role === 'TH' })))
      if (!table.length || table.some(row => !row.length)) return
      parts.push({ kind: 'table', table }); return
    }
    if (['P', 'LI', 'Caption'].includes(node.role ?? '') || node.type === 'content') {
      const value = text(node).trim()
      if (value) parts.push({ kind: 'text', text: node.role === 'LI' ? `- ${value}` : value })
      return
    }
    for (const item of node.children ?? []) visit(item)
  }
  visit(root)
  // An unsupported structural object must not quietly consume its text.
  const represented = parts.map(part => part.kind === 'table' ? part.table.map(row => row.map(cell => cell.text).join(' ')).join(' ') : part.text.replace(/^- /, '')).join(' ')
  return parts.length && normalize(represented) === normalize(raw) ? parts : null
}
