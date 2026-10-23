import { insist } from './core'
export interface LessonTable { text: string; table: LessonCell[][] }
export interface LessonCell { text: string; colSpan: number; rowSpan: number; header: boolean; tables?: LessonTable[] }
export const MAX_TABLE_DEPTH = 4
export const MAX_TABLE_CELLS = 1000
/** Each nested grid has its own span geometry; the whole tree shares one cell budget. */
export function normaliseTable(value: unknown, { plainText = true }: { plainText?: boolean } = {}): LessonCell[][] {
  const budget = { cells: 0 }
  return grid(value, 1, budget, plainText)
}
function grid(value: unknown, depth: number, budget: { cells: number }, plainText: boolean): LessonCell[][] {
  insist(depth <= MAX_TABLE_DEPTH && Array.isArray(value) && value.length > 0 && value.length <= 100, 'invalid_table')
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && (!plainText || !/<\/?[a-z!][^>]*>/i.test(value))
  const occupied: number[] = []
  const table = value.map((row: unknown, index: number) => {
    insist(Array.isArray(row) && row.length <= 30 && (row.length || occupied.some(span => span > 0)), 'invalid_table_row')
    let column = 0
    const result = row.map(cell => {
      while (occupied[column] > 0) column++
      insist(++budget.cells <= MAX_TABLE_CELLS && cell && typeof cell === 'object' && !Array.isArray(cell) && text(cell.text, 5000), 'invalid_table_cell')
      insist(Number.isInteger(cell.colSpan) && cell.colSpan >= 1 && cell.colSpan <= 30 && Number.isInteger(cell.rowSpan) && cell.rowSpan >= 1 && cell.rowSpan <= value.length - index && typeof cell.header === 'boolean', 'invalid_table_span')
      insist(column + cell.colSpan <= 30, 'invalid_table_width')
      for (let offset = 0; offset < cell.colSpan; offset++) { insist(!occupied[column + offset], 'overlapping_table_cell'); occupied[column + offset] = cell.rowSpan }
      column += cell.colSpan
      const result: LessonCell = { text: cell.text, colSpan: cell.colSpan, rowSpan: cell.rowSpan, header: cell.header }
      if (cell.tables !== undefined) {
        insist(Array.isArray(cell.tables) && cell.tables.length <= MAX_TABLE_CELLS, 'invalid_nested_table')
        result.tables = cell.tables.map((nested: unknown) => {
          insist(nested && typeof nested === 'object' && !Array.isArray(nested) && Object.keys(nested).every(key => key === 'text' || key === 'table') && 'text' in nested && 'table' in nested && text(nested.text, 10_000) && nested.text.trim(), 'invalid_nested_table')
          return { text: nested.text, table: grid(nested.table, depth + 1, budget, plainText) }
        })
      }
      return result
    })
    for (let column = 0; column < occupied.length; column++) if (occupied[column]) occupied[column]--
    return result
  })
  return table
}
