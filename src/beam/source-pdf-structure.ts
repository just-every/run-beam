// Tagged PDFs carry authored reading order, heading and table semantics.
// Account for text by marked-content identity, independently of paint order.
import { insist } from './core'
import type { SourceCell } from './source-content'
import { taggedPdfTable, type PdfStructure } from './source-pdf-tables'
interface TextRun { str?: string; hasEOL?: boolean; type?: string; id?: string }
type Part = { kind: 'heading' | 'text'; text: string } | { kind: 'table'; table: SourceCell[][] }
const normalize = (value: string) => value.replace(/\s/g, '')
export function taggedPdfContent(tree: unknown, runs: TextRun[]): Part[] | null {
  if (!tree) return null
  const mapped = new Map<string, string>(), stack: string[] = []
  for (const run of runs) {
    if (typeof run.str === 'string') {
      // Untagged wrappers do not hide their nearest marked-content ancestor.
      const id = stack.at(-1)
      if (!id && normalize(run.str)) return null
      if (id) mapped.set(id, (mapped.get(id) ?? '') + run.str + (run.hasEOL ? '\n' : ' '))
    } else if (run.type === 'beginMarkedContent' || run.type === 'beginMarkedContentProps') stack.push(run.id || stack.at(-1) || '')
    else if (run.type === 'endMarkedContent') { if (!stack.length) return null; stack.pop() }
  }
  if (stack.length) return null
  const root = tree as PdfStructure, cached = new Map<PdfStructure, string>(), referenced = new Set<string>()
  let nodes = 0, valid = true
  function index(node: PdfStructure, depth = 0): string {
    insist(++nodes <= 20_000 && depth <= 64, 'document_pdf_structure_limit', 422)
    if (cached.has(node)) { valid = false; return '' }
    cached.set(node, '')
    let value: string
    if (node.type === 'content') {
      if (!node.id || referenced.has(node.id) || node.children?.length) valid = false
      else referenced.add(node.id)
      value = mapped.get(node.id ?? '') ?? ''
    } else value = (node.children ?? []).map(item => index(item, depth + 1)).join(' ')
    cached.set(node, value)
    return value
  }
  const authored = index(root)
  const textIds = [...mapped].filter(([, value]) => normalize(value)).map(([id]) => id)
  if (!valid || textIds.some(id => !referenced.has(id))) return null
  const parts: Part[] = [], represented: string[] = [], consumed = new Set<string>()
  function take(node: PdfStructure, omitTables = false): string {
    const values: string[] = []
    function account(item: PdfStructure) {
      if (omitTables && item !== node && item.role === 'Table') return
      if (item.type === 'content' && item.id && normalize(mapped.get(item.id) ?? '')) {
        if (consumed.has(item.id)) valid = false
        consumed.add(item.id)
        values.push(mapped.get(item.id) ?? '')
      }
      for (const child of item.children ?? []) account(child)
    }
    account(node)
    return values.join(' ')
  }
  function tableContent(table: SourceCell[][]): string {
    return table.flatMap(row => row.map(cell => [cell.text, ...(cell.tables ?? []).map(nested => tableContent(nested.table))].join(' '))).join(' ')
  }
  function visit(node: PdfStructure) {
    if (/^H[1-6]?$/.test(node.role ?? '')) {
      const value = take(node).trim()
      if (value) { parts.push({ kind: 'heading', text: value }); represented.push(value) }
      return
    }
    if (node.role === 'Table') {
      const table = taggedPdfTable(node, take)
      if (!table) valid = false
      else { parts.push({ kind: 'table', table }); represented.push(tableContent(table)) }
      return
    }
    if (['P', 'LI', 'Caption'].includes(node.role ?? '') || node.type === 'content') {
      const value = take(node).trim()
      if (value) { parts.push({ kind: 'text', text: node.role === 'LI' ? `- ${value}` : value }); represented.push(value) }
      return
    }
    for (const item of node.children ?? []) visit(item)
  }
  visit(root)
  // Identity coverage prevents identical text from hiding a dropped or doubled
  // passage; text equality additionally checks that output retained its content.
  return valid && parts.length && textIds.every(id => consumed.has(id)) && normalize(represented.join(' ')) === normalize(authored) ? parts : null
}
