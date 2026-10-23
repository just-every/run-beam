import type { LessonCell } from '../lesson-tables'
import { h, type Html } from './html'

/** The same native table markup is used at every level, inside its owning cell. */
export function renderLessonTable(text: string, table: LessonCell[][]): Html {
  const content = (cell: LessonCell) => h`${cell.text}${cell.tables?.map(nested => renderLessonTable(nested.text, nested.table))}`
  return h`<div class="table-wrap"><table><caption>${text}</caption><tbody>${table.map(row => h`<tr>${row.map(cell => cell.header ? h`<th scope="col" colspan="${cell.colSpan}" rowspan="${cell.rowSpan}">${content(cell)}</th>` : h`<td colspan="${cell.colSpan}" rowspan="${cell.rowSpan}">${content(cell)}</td>`)}</tr>`)}</tbody></table></div>`
}
