// PDF.js exposes authored Table attributes; infer no missing spans or cells.
import type { SourceCell } from './source-content'
export interface PdfStructure { role?: string; type?: string; id?: string; children?: PdfStructure[]; rowSpan?: number; colSpan?: number }

export function taggedPdfTable(node: PdfStructure, text: (node: PdfStructure, omitTables?: boolean) => string, depth = 1, budget = { cells: 0 }): SourceCell[][] | null {
  const rows: PdfStructure[] = []
  function collect(item: PdfStructure) {
    if (item !== node && item.role === 'Table') return
    if (item.role === 'TR') rows.push(item)
    for (const child of item.children ?? []) collect(child)
  }
  collect(node)
  if (depth > 4 || !rows.length || rows.length > 100) return null
  const occupied: boolean[][] = rows.map(() => []), table: SourceCell[][] = []
  let width: number | undefined
  for (const [index, row] of rows.entries()) {
    const cells: SourceCell[] = []
    let column = 0
    for (const cell of row.children ?? []) {
      if (cell.role !== 'TH' && cell.role !== 'TD') continue
      while (occupied[index][column]) column++
      const colSpan = cell.colSpan ?? 1, rowSpan = cell.rowSpan ?? 1
      if (++budget.cells > 1000 || !Number.isInteger(colSpan) || colSpan < 1 || colSpan > 30 || !Number.isInteger(rowSpan)
        || rowSpan < 1 || rowSpan > rows.length - index || column + colSpan > 30) return null
      for (let y = index; y < index + rowSpan; y++) for (let x = column; x < column + colSpan; x++) {
        if (occupied[y][x]) return null
        occupied[y][x] = true
      }
      const value = text(cell, true).trim()
      if (value.length > 5000) return null
      const nested: { text: string; table: SourceCell[][] }[] = []
      let nestedValid = true
      function childTables(item: PdfStructure) {
        for (const child of item.children ?? []) {
          if (child.role === 'Table') {
            const table = taggedPdfTable(child, text, depth + 1, budget)
            if (!table) nestedValid = false
            else nested.push({ text: 'Nested PDF table', table })
          } else childTables(child)
        }
      }
      childTables(cell)
      if (!nestedValid) return null
      cells.push({ text: value, colSpan, rowSpan, header: cell.role === 'TH', ...(nested.length ? { tables: nested } : {}) })
      column += colSpan
    }
    width ??= occupied[index].length
    if (!width || occupied[index].length !== width || Array.from({ length: width }, (_, x) => !occupied[index][x]).some(Boolean)) return null
    table.push(cells)
  }
  return table
}
