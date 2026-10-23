import type { SourceCell } from '../source-content'
import { field, h, type Html } from './html'

/** The visible order matches tableCellEntries used by the ordinary form handler. */
export function sourceTableFields(table: SourceCell[][], prefix = ''): Html {
  return h`<div class="table-wrap"><table><tbody>${table.map((row, rowIndex) => h`<tr>${row.map((cell, column) => {
    const label = `${prefix}${prefix ? 'row' : 'Row'} ${rowIndex + 1}, cell ${column + 1}`
    return h`<td colspan="${cell.colSpan}" rowspan="${cell.rowSpan}">${field(label, 'tableCells', { value: cell.text, required: false })}${cell.tables?.map((nested, index) => h`<fieldset><legend>${nested.text}</legend>${sourceTableFields(nested.table, `${label}, nested table ${index + 1}, `)}</fieldset>`)}</td>`
  })}</tr>`)}</tbody></table></div>`
}
