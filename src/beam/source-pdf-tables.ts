// PDF.js exposes authored Table attributes; infer no missing spans or cells.
import type { SourceCell } from './source-content'
export interface PdfStructure { role?: string; type?: string; id?: string; children?: PdfStructure[]; rowSpan?: number; colSpan?: number }

export function taggedPdfTable(node: PdfStructure, text: (node: PdfStructure) => string): SourceCell[][] | null {
  const rows: PdfStructure[] = []
  let nested = false
  function collect(item: PdfStructure) {
    if (item !== node && item.role === 'Table') nested = true
    if (item.role === 'TR') rows.push(item)
    for (const child of item.children ?? []) collect(child)
  }
  collect(node)
  if (nested || !rows.length || rows.length > 100) return null
  const occupied: boolean[][] = rows.map(() => []), table: SourceCell[][] = []
  let width: number | undefined, count = 0
  for (const [index, row] of rows.entries()) {
    const cells: SourceCell[] = []
    let column = 0
    for (const cell of row.children ?? []) {
      if (cell.role !== 'TH' && cell.role !== 'TD') continue
      while (occupied[index][column]) column++
      const colSpan = cell.colSpan ?? 1, rowSpan = cell.rowSpan ?? 1
      if (++count > 1000 || !Number.isInteger(colSpan) || colSpan < 1 || colSpan > 30 || !Number.isInteger(rowSpan)
        || rowSpan < 1 || rowSpan > rows.length - index || column + colSpan > 30) return null
      for (let y = index; y < index + rowSpan; y++) for (let x = column; x < column + colSpan; x++) {
        if (occupied[y][x]) return null
        occupied[y][x] = true
      }
      const value = text(cell).trim()
      if (value.length > 5000) return null
      cells.push({ text: value, colSpan, rowSpan, header: cell.role === 'TH' })
      column += colSpan
    }
    width ??= occupied[index].length
    if (!width || occupied[index].length !== width || Array.from({ length: width }, (_, x) => !occupied[index][x]).some(Boolean)) return null
    table.push(cells)
  }
  return table
}
