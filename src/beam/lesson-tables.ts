import { insist } from './core'
export interface LessonCell { text: string; colSpan: number; rowSpan: number; header: boolean }
export function normaliseTable(value: unknown): LessonCell[][] {
  insist(Array.isArray(value) && value.length > 0 && value.length <= 100, 'invalid_table')
  let cells = 0
  const occupied: number[] = []
  const table = value.map((row: unknown, index: number) => {
    insist(Array.isArray(row) && row.length <= 30 && (row.length || occupied.some(span => span > 0)), 'invalid_table_row')
    let column = 0
    const result = row.map(cell => {
      while (occupied[column] > 0) column++
      insist(++cells <= 1000 && cell && typeof cell.text === 'string' && cell.text.length <= 5000 && !/<\/?[a-z!][^>]*>/i.test(cell.text), 'invalid_table_cell')
      insist(Number.isInteger(cell.colSpan) && cell.colSpan >= 1 && cell.colSpan <= 30 && Number.isInteger(cell.rowSpan) && cell.rowSpan >= 1 && cell.rowSpan <= value.length - index && typeof cell.header === 'boolean', 'invalid_table_span')
      insist(column + cell.colSpan <= 30, 'invalid_table_width')
      for (let offset = 0; offset < cell.colSpan; offset++) { insist(!occupied[column + offset], 'overlapping_table_cell'); occupied[column + offset] = cell.rowSpan }
      column += cell.colSpan
      return { text: cell.text, colSpan: cell.colSpan, rowSpan: cell.rowSpan, header: cell.header }
    })
    for (let column = 0; column < occupied.length; column++) if (occupied[column]) occupied[column]--
    return result
  })
  return table
}
