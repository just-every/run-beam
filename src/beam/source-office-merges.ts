// Word's legacy hMerge describes physical cells. Normalize each explicit
// horizontal group to gridSpan before the existing vertical-grid validation.
import { insist } from './core'
import { attribute as attr, child, children, localName, type XmlNode } from './source-archive'

type Merge = 'restart' | 'continue' | undefined
function merge(properties: XmlNode | undefined, name: string): Merge {
  const nodes = properties ? children(properties, name) : []
  insist(nodes.length <= 1, 'document_invalid_table_merge', 422)
  const value = nodes.length ? attr(nodes[0], 'val') ?? 'continue' : undefined
  insist(value === undefined || value === 'restart' || value === 'continue', 'document_invalid_table_merge', 422)
  return value
}

export function wordTableCells(row: XmlNode, continuation: (cell: XmlNode) => boolean): XmlNode[] {
  const result: XmlNode[] = []
  let owner: { cell: XmlNode; properties: XmlNode; span: number; vertical: Merge } | undefined
  for (const cell of children(row, 'tc')) {
    insist(children(cell, 'tcPr').length <= 1, 'document_invalid_table_merge', 422)
    const properties = child(cell, 'tcPr')
    const horizontal = merge(properties, 'hMerge'), vertical = merge(properties, 'vMerge')
    insist(!properties || children(properties, 'gridSpan').length <= 1, 'document_invalid_table_merge', 422)
    const span = Number(attr(child(properties, 'gridSpan'), 'val') ?? 1)
    insist(Number.isInteger(span) && span > 0 && span <= 30, 'document_table_limit', 422)
    if (horizontal === 'continue') {
      // Mixing vertical states inside one horizontal group would manufacture a
      // rectangle from cells that do not share the same vertical owner.
      insist(owner && owner.vertical === vertical, 'document_invalid_table_merge', 422)
      owner.span += span
      insist(owner.span <= 30, 'document_table_limit', 422)
      owner.properties.children = owner.properties.children.filter(item => typeof item === 'string' || localName(item.name) !== 'gridSpan')
      owner.properties.children.push({ name: 'w:gridSpan', attrs: { 'w:val': String(owner.span) }, children: [] })
      // Empty physical placeholders must not append blank paragraphs to the
      // origin. Images are extracted separately from the untouched source tree.
      if (continuation(cell)) owner.cell.children.push(...cell.children.filter(item => typeof item === 'string' || localName(item.name) !== 'tcPr'))
    } else if (horizontal === 'restart') {
      const normalizedProperties: XmlNode = { ...properties!, children: properties!.children.filter(item => typeof item === 'string' || !['hMerge', 'gridSpan'].includes(localName(item.name))) }
      normalizedProperties.children.push({ name: 'w:gridSpan', attrs: { 'w:val': String(span) }, children: [] })
      const normalizedCell: XmlNode = { ...cell, children: cell.children.map(item => item === properties ? normalizedProperties : item) }
      result.push(normalizedCell)
      owner = { cell: normalizedCell, properties: normalizedProperties, span, vertical }
    } else {
      result.push(cell)
      owner = undefined
    }
  }
  return result
}
