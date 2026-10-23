import { insist } from './core'
import { normaliseTable, type LessonCell } from './lesson-tables'

export interface TableCellEntry {
  cell: LessonCell
  /** One-based row/cell labels, including every owning cell and nested table. */
  label: string
  row: number
  column: number
}
/** Row-major preorder: the owning cell precedes all cells in its nested tables. */
export function tableCellEntries(table: LessonCell[][], prefix = ''): TableCellEntry[] {
  const entries: TableCellEntry[] = []
  for (const [rowIndex, row] of table.entries()) for (const [column, cell] of row.entries()) {
    const label = `${prefix}${prefix ? 'row' : 'Row'} ${rowIndex + 1}, cell ${column + 1}`
    entries.push({ cell, label, row: rowIndex, column })
    for (const [index, nested] of (cell.tables ?? []).entries()) entries.push(...tableCellEntries(nested.table, `${label}, nested table ${index + 1}, `))
  }
  return entries
}

/** A form carries all spans, headers and nested captions, with cell text posted separately. */
export function tableShape(table: LessonCell[][]): LessonCell[][] {
  const shape = structuredClone(table)
  for (const { cell } of tableCellEntries(shape)) cell.text = ''
  return shape
}

export function fillTableCells(shape: unknown, values: string[]): LessonCell[][] {
  const table = normaliseTable(shape), entries = tableCellEntries(table)
  insist(entries.length === values.length, 'invalid_table_cells')
  for (const [index, { cell }] of entries.entries()) cell.text = values[index]
  return normaliseTable(table)
}

/** Located source passages include nested captions and text, without replacing the actual grids. */
export function tableText(table: LessonCell[][]): string {
  return table.map(row => row.map(cell => [cell.text, ...(cell.tables ?? []).map(nested => `${nested.text}\n${tableText(nested.table)}`)].join('\n')).join('\t')).join('\n')
}
