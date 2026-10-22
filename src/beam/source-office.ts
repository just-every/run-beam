import { insist } from './core'
import { attribute as attr, child, children, descendants, elements, localName as local, officeArchive, relationships, type XmlNode, type OfficeArchive } from './source-archive'
import { SourceContent, type SourceCell } from './source-content'

function paragraphText(node: XmlNode, content: SourceContent): string {
  const name = local(node.name)
  if (name === 't') return node.children.filter(item => typeof item === 'string').join('')
  if (name === 'tab') return '\t'
  if (name === 'br' || name === 'cr') return '\n'
  if (name === 'del' || name === 'moveFrom') { content.warnings.add('Deleted or moved-from tracked text was omitted; resolve tracked changes against the original.'); return '' }
  return elements(node).map(item => paragraphText(item, content)).join('')
}
function images(node: XmlNode, part: string, archive: OfficeArchive, content: SourceContent, location: string) {
  const rels = relationships(archive, part)
  // Drawings and pictures are package data, including their existing alt text.
  const drawings = [...descendants(node, 'drawing'), ...descendants(node, 'pic')]
    .filter((item, index, all) => !all.some((other, otherIndex) => index !== otherIndex && descendants(other, local(item.name)).includes(item)))
  for (const drawing of drawings) {
    const properties = descendants(drawing, 'docPr')[0] ?? descendants(drawing, 'cNvPr')[0]
    const blip = descendants(drawing, 'blip')[0]
    const relation = rels.get(attr(blip, 'embed') ?? '')
    const description = attr(properties, 'descr') || attr(properties, 'title') || ''
    if (relation?.external || attr(blip, 'link')) content.warnings.add('An external image was not fetched. Inspect it in the original and upload a licensed local copy if needed.')
    const path = relation && !relation.external ? relation.path : ''
    content.image(path && archive.has(path) ? archive.read(path, 8_000_000) : undefined, path.split('/').at(-1) || 'image', description, location)
  }
}
function table(node: XmlNode, content: SourceContent, pptx: boolean, location: string): SourceCell[][] | undefined {
  const rows = children(node, 'tr'), result: SourceCell[][] = []
  insist(rows.length > 0 && rows.length <= 100, 'document_table_limit', 422)
  // These layouts cannot be represented faithfully by the lesson table grid.
  // Retain the located text and require an explicit comparison, rather than
  // manufacturing spans or silently dropping the unsupported cell contents.
  if (descendants(node, 'tbl').length || !pptx && rows.some(row => {
    const properties = child(row, 'trPr')
    return ['gridBefore', 'gridAfter'].some(name => Number(attr(child(properties, name), 'val') || 0) !== 0) || children(row, 'tc').some(cell => child(child(cell, 'tcPr'), 'hMerge'))
  })) {
    const reason = 'An unsupported table layout (nested table, omitted grid cells or legacy horizontal merge) was retained as text. Reconstruct its cells against the original before conversion.'
    const text = descendants(node, 'p').map(p => paragraphText(p, content)).join('\n')
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
    for (const cell of children(row, 'tc')) {
      const properties = child(cell, 'tcPr'), merge = child(properties, 'vMerge')
      const span = Number(pptx ? attr(cell, 'gridSpan') || 1 : attr(child(properties, 'gridSpan'), 'val') || 1)
      const rowSpan = pptx ? Number(attr(cell, 'rowSpan') || 1) : 1
      insist(Number.isInteger(span) && span > 0 && span <= 30 && Number.isInteger(rowSpan) && rowSpan > 0 && rowSpan <= rows.length - rowIndex, 'document_table_limit', 422)
      const body = pptx ? child(cell, 'txBody') : cell
      const text = body ? children(body, 'p').map(p => paragraphText(p, content)).join('\n') : ''
      if (pptx) {
        // DrawingML keeps a physical tc for EVERY grid position, including
        // covered cells. A gridSpan must not advance past those placeholders.
        const horizontal = ['1', 'true'].includes(attr(cell, 'hMerge') ?? '')
        const vertical = ['1', 'true'].includes(attr(cell, 'vMerge') ?? '')
        const owner = occupied[rowIndex][column]
        if (owner) {
          insist(horizontal === (column > owner.column) && vertical === (rowIndex > owner.row), 'document_invalid_table_merge', 422)
          insist(span === (column === owner.column ? owner.cell.colSpan : 1) && rowSpan === (rowIndex === owner.row ? owner.cell.rowSpan : 1), 'document_invalid_table_merge', 422)
          if (text.trim()) {
            const reason = 'A merged table continuation contains text. Compare and place this text in the merged cell before conversion.'
            content.warnings.add(reason); content.uncertain(location, text, reason)
            owner.cell.text += `${owner.cell.text ? '\n' : ''}${text}`
          }
        } else {
          insist(!horizontal && !vertical && column + span <= 30 && (!width || column + span <= width), 'document_invalid_table_merge', 422)
          const value: SourceCell = { text, colSpan: span, rowSpan, header }
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
          if (text.trim()) {
            const reason = 'A merged table continuation contains text. Compare and place this text in the merged cell before conversion.'
            content.warnings.add(reason); content.uncertain(location, text, reason)
            owner.cell.text += `${owner.cell.text ? '\n' : ''}${text}`
          }
          for (let offset = 0; offset < span; offset++) current.set(column + offset, owner)
        } else {
          const value: SourceCell = { text, colSpan: span, rowSpan: 1, header }
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

export function extractDocx(bytes: Uint8Array, content: SourceContent) {
  const archive = officeArchive(bytes)
  insist(archive.has('word/document.xml'), 'document_no_word_body', 422)
  const document = archive.xml('word/document.xml'), body = child(document, 'body')
  insist(local(document.name) === 'document' && body, 'document_no_word_body', 422)
  const headingStyles = new Set<string>()
  if (archive.has('word/styles.xml')) for (const style of children(archive.xml('word/styles.xml'), 'style')) {
    const name = attr(child(style, 'name'), 'val') ?? '', outline = attr(child(child(style, 'pPr'), 'outlineLvl'), 'val')
    if (/^heading\s*[1-9]$/i.test(name) || outline !== undefined && Number(outline) < 9) headingStyles.add(attr(style, 'styleId') ?? '')
  }
  content.warnings.add('Check lists, merged cells, formatting, headers, footnotes, tracked changes and omitted objects against the original. Tables and images become editable lesson blocks after the lesson text.')
  for (const [index, node] of elements(body).entries()) {
    const name = local(node.name), location = `Document block ${index + 1}`
    if (name === 'p') {
      const properties = child(node, 'pPr'), style = attr(child(properties, 'pStyle'), 'val') ?? ''
      const value = paragraphText(node, content), outline = attr(child(properties, 'outlineLvl'), 'val')
      if (value.trim()) {
        if (/^(?:heading[1-9]|title)$/i.test(style) || headingStyles.has(style) || outline !== undefined && Number(outline) < 9) content.heading(value, location)
        else content.text(value, location)
      }
      images(node, 'word/document.xml', archive, content, location)
    } else if (name === 'tbl') {
      const cells = table(node, content, false, location)
      if (cells) content.table(cells, location)
      images(node, 'word/document.xml', archive, content, location)
    } else if (name !== 'sectPr') content.warnings.add('An unsupported document block was omitted; inspect the original before preparing lessons.')
  }
}

export function extractPptx(bytes: Uint8Array, content: SourceContent) {
  const archive = officeArchive(bytes), part = 'ppt/presentation.xml'
  insist(archive.has(part), 'document_no_presentation', 422)
  const presentation = archive.xml(part), rels = relationships(archive, part)
  const slides = children(child(presentation, 'sldIdLst') ?? presentation, 'sldId')
  insist(slides.length > 0 && slides.length <= 60, 'document_slide_limit', 422)
  content.warnings.add('Slides retain presentation order, text, tables and embedded raster images. Check reading order, diagrams, charts, speaker notes, animation and master-slide content against the original; these are not reconstructed.')
  for (const [slideIndex, slide] of slides.entries()) {
    const relation = rels.get(attr(slide, 'id') ?? '')
    // p:sldId has numeric id and r:id: resolve the relationship namespace explicitly.
    const relationshipId = Object.entries(slide.attrs).find(([name]) => name.includes(':') && local(name) === 'id')?.[1]
    const resolved = rels.get(relationshipId ?? '') ?? relation
    insist(resolved && !resolved.external && archive.has(resolved.path) && /\/slide$/.test(resolved.type), 'document_invalid_slide', 422)
    const tree = child(child(archive.xml(resolved.path), 'cSld'), 'spTree')
    insist(tree, 'document_invalid_slide', 422)
    const titleShape = children(tree, 'sp').find(shape => descendants(shape, 'ph').some(ph => ['title', 'ctrTitle'].includes(attr(ph, 'type') ?? '')))
    const title = titleShape ? descendants(titleShape, 'txBody').map(body => children(body, 'p').map(p => paragraphText(p, content)).join(' ')).join(' ') : ''
    content.heading(title.trim() || `Slide ${slideIndex + 1}`, `Slide ${slideIndex + 1}`)
    for (const [shapeIndex, shape] of elements(tree).entries()) {
      const location = `Slide ${slideIndex + 1}, object ${shapeIndex + 1}`
      if (shape !== titleShape) for (const body of descendants(shape, 'txBody').filter(body => !descendants(shape, 'tbl').some(tbl => descendants(tbl, 'txBody').includes(body)))) {
        for (const paragraph of children(body, 'p')) content.text(paragraphText(paragraph, content), location)
      }
      for (const grid of descendants(shape, 'tbl')) {
        const cells = table(grid, content, true, location)
        if (cells) content.table(cells, location, `Slide ${slideIndex + 1} table`)
      }
      // A picture is itself an image container, unlike a Word paragraph.
      images({ name: 'container', attrs: {}, children: [shape] }, resolved.path, archive, content, location)
      if (['graphicFrame', 'grpSp'].includes(local(shape.name)) && !descendants(shape, 'tbl').length && !descendants(shape, 'txBody').length && !descendants(shape, 'pic').length) content.warnings.add('An unsupported slide object was omitted. Inspect the original presentation.')
    }
  }
}
