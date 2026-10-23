// Word and DrawingML grids, including bounded nested Word tables and explicit merge owners.
import { insist } from './core'
import { attribute as attr, child, children, descendants, type XmlNode } from './source-archive'
import { SourceContent, type SourceCell } from './source-content'
import { wordTableCells } from './source-office-merges'
import { MAX_TABLE_CELLS, MAX_TABLE_DEPTH } from './lesson-tables'
import { tableText } from './table-traversal'

export function officeTable(node: XmlNode, content: SourceContent, pptx: boolean, location: string, paragraphText: (node: XmlNode) => string, depth = 1, budget = { cells: 0 }): SourceCell[][] | undefined {
  insist(depth <= MAX_TABLE_DEPTH, 'document_table_limit', 422)
  const rows = children(node, 'tr'), result: SourceCell[][] = []
  insist(rows.length > 0 && rows.length <= 100, 'document_table_limit', 422)
  if (pptx && descendants(node, 'tbl').length) {
    const reason = 'An unsupported nested presentation table was retained as text. Reconstruct its cells against the original before conversion.'
    const text = descendants(node, 'p').map(p => paragraphText(p)).join('\n')
    content.warnings.add(reason); content.uncertain(location, text, reason); content.text(text, location)
    return
  }
  // Omitted grid positions still require comparison; nesting itself is represented.
  if (!pptx && rows.some(row => {
    const properties = child(row, 'trPr')
    return ['gridBefore', 'gridAfter'].some(name => Number(attr(child(properties, name), 'val') || 0) !== 0)
  })) {
    const reason = 'A table with omitted grid cells was retained as text. Reconstruct its cells against the original before conversion.'
    const text = descendants(node, 'p').map(p => paragraphText(p)).join('\n')
    content.warnings.add(reason); content.uncertain(location, text, reason); content.text(text, location)
    return
  }
  let previous = new Map<number, { cell: SourceCell; column: number }>()
  const occupied: ({ cell: SourceCell; row: number; column: number } | undefined)[][] = rows.map(() => [])
  const firstRow = ['1', 'true'].includes(attr(child(node, 'tblPr'), 'firstRow') ?? '')
  const gridWidth = children(child(node, 'tblGrid') ?? node, 'gridCol').length
  let width = gridWidth || undefined
  for (const [rowIndex, row] of rows.entries()) {
    const cells: SourceCell[] = [], current = new Map<number, { cell: SourceCell; column: number }>()
    let column = 0
    const headerFlag = child(child(row, 'trPr'), 'tblHeader')
    const header = pptx ? firstRow && rowIndex === 0 : !!headerFlag && !['0', 'false', 'off'].includes(attr(headerFlag, 'val') ?? '')
    const rowCells = pptx ? children(row, 'tc') : wordTableCells(row, cell => {
      const text = descendants(cell, 'p').map(p => paragraphText(p)).join('\n')
      const nested = children(cell, 'tbl').length > 0
      if (text.trim() || nested) {
        const reason = 'A merged table continuation contains text or a nested table. Compare its placement in the merged cell before conversion.'
        content.warnings.add(reason); content.uncertain(location, text, reason)
      }
      return !!text.trim() || nested
    })
    for (const cell of rowCells) {
      insist(++budget.cells <= MAX_TABLE_CELLS, 'document_table_limit', 422)
      const properties = child(cell, 'tcPr'), merge = child(properties, 'vMerge')
      const span = Number(pptx ? attr(cell, 'gridSpan') || 1 : attr(child(properties, 'gridSpan'), 'val') || 1)
      const rowSpan = pptx ? Number(attr(cell, 'rowSpan') || 1) : 1
      insist(Number.isInteger(span) && span > 0 && span <= 30 && Number.isInteger(rowSpan) && rowSpan > 0 && rowSpan <= rows.length - rowIndex, 'document_table_limit', 422)
      const body = pptx ? child(cell, 'txBody') : cell
      const text = body ? children(body, 'p').map(p => paragraphText(p)).join('\n').trim() : ''
      const tables = pptx ? [] : children(cell, 'tbl').flatMap((nested, index) => {
        const nestedLocation = `${location}, row ${rowIndex + 1}, cell ${column + 1}, nested table ${index + 1}`
        const grid = officeTable(nested, content, false, nestedLocation, paragraphText, depth + 1, budget)
        return grid ? [{ text: attr(child(child(nested, 'tblPr'), 'tblCaption'), 'val') || 'Procedure table', table: grid }] : []
      })
      if (pptx) {
        // DrawingML keeps a physical tc for EVERY grid position, including
        // covered cells. A gridSpan must not advance past those placeholders.
        const horizontal = ['1', 'true'].includes(attr(cell, 'hMerge') ?? '')
        const vertical = ['1', 'true'].includes(attr(cell, 'vMerge') ?? '')
        const owner = occupied[rowIndex][column]
        if (owner) {
          insist(horizontal === (column > owner.column) && vertical === (rowIndex > owner.row), 'document_invalid_table_merge', 422)
          insist(span === (column === owner.column ? owner.cell.colSpan : 1) && rowSpan === (rowIndex === owner.row ? owner.cell.rowSpan : 1), 'document_invalid_table_merge', 422)
          if (text.trim() || tables.length) {
            const reason = 'A merged table continuation contains text or a nested table. Compare its placement in the merged cell before conversion.'
            content.warnings.add(reason); content.uncertain(location, [text, ...tables.map(nested => tableText(nested.table))].join('\n'), reason)
            if (text.trim()) owner.cell.text += `${owner.cell.text ? '\n' : ''}${text}`
            if (tables.length) (owner.cell.tables ??= []).push(...tables)
          }
        } else {
          insist(!horizontal && !vertical && column + span <= 30 && (!width || column + span <= width), 'document_invalid_table_merge', 422)
          const value: SourceCell = { text, colSpan: span, rowSpan, header, ...(tables.length ? { tables } : {}) }
          cells.push(value)
          for (let y = rowIndex; y < rowIndex + rowSpan; y++) for (let x = column; x < column + span; x++) {
            insist(!occupied[y][x], 'document_invalid_table_merge', 422)
            occupied[y][x] = { cell: value, row: rowIndex, column }
          }
        }
        column++
      } else {
        const state = merge ? attr(merge, 'val') ?? 'continue' : undefined
        insist(state === undefined || state === 'restart' || state === 'continue', 'document_invalid_table_merge', 422)
        if (state === 'continue') {
          const owner = previous.get(column)
          insist(owner && owner.column === column && owner.cell.colSpan === span && Array.from({ length: span }, (_, offset) => previous.get(column + offset)).every(value => value === owner), 'document_invalid_table_merge', 422)
          owner.cell.rowSpan++
          if (text.trim() || tables.length) {
            const reason = 'A merged table continuation contains text or a nested table. Compare its placement in the merged cell before conversion.'
            content.warnings.add(reason); content.uncertain(location, [text, ...tables.map(nested => tableText(nested.table))].join('\n'), reason)
            if (text.trim()) owner.cell.text += `${owner.cell.text ? '\n' : ''}${text}`
            if (tables.length) (owner.cell.tables ??= []).push(...tables)
          }
          for (let offset = 0; offset < span; offset++) current.set(column + offset, owner)
        } else {
          const value: SourceCell = { text, colSpan: span, rowSpan: 1, header, ...(tables.length ? { tables } : {}) }
          cells.push(value)
          if (state === 'restart') {
            const owner = { cell: value, column }
            for (let offset = 0; offset < span; offset++) current.set(column + offset, owner)
          }
        }
        column += span
      }
      insist(column <= 30, 'document_table_limit', 422)
    }
    width ??= column
    insist(column === width && (!pptx || occupied[rowIndex].length === column), 'document_invalid_table_merge', 422)
    previous = current
    result.push(cells)
  }
  return result
}

