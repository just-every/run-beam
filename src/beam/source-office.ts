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
function table(node: XmlNode, content: SourceContent, pptx: boolean): SourceCell[][] {
  const previous = new Map<number, SourceCell>(), result: SourceCell[][] = []
  const firstRow = pptx && attr(child(node, 'tblPr'), 'firstRow') === '1'
  for (const [rowIndex, row] of children(node, 'tr').entries()) {
    const cells: SourceCell[] = []; let column = 0
    const header = pptx ? firstRow && rowIndex === 0 : !!child(child(row, 'trPr'), 'tblHeader') && attr(child(child(row, 'trPr'), 'tblHeader'), 'val') !== '0'
    for (const cell of children(row, 'tc')) {
      const properties = child(cell, 'tcPr')
      const span = Number(pptx ? attr(cell, 'gridSpan') || 1 : attr(child(properties, 'gridSpan'), 'val') || 1)
      const vertical = pptx ? attr(cell, 'vMerge') === '1' : !!child(properties, 'vMerge') && attr(child(properties, 'vMerge'), 'val') !== 'restart'
      const horizontal = pptx && attr(cell, 'hMerge') === '1'
      insist(Number.isInteger(span) && span > 0 && span <= 30, 'document_table_limit', 422)
      if (vertical) {
        const prior = previous.get(column)
        insist(prior, 'document_invalid_table_merge', 422)
        if (!pptx) prior.rowSpan++
      } else if (!horizontal) {
        const body = pptx ? child(cell, 'txBody') : cell
        const value: SourceCell = { text: body ? children(body, 'p').map(p => paragraphText(p, content)).join('\n') : '', colSpan: span, rowSpan: pptx ? Number(attr(cell, 'rowSpan') || 1) : 1, header }
        cells.push(value)
        for (let index = 0; index < span; index++) previous.set(column + index, value)
      }
      column += span
    }
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
      content.table(table(node, content, false), location)
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
      for (const grid of descendants(shape, 'tbl')) content.table(table(grid, content, true), location, `Slide ${slideIndex + 1} table`)
      // A picture is itself an image container, unlike a Word paragraph.
      images({ name: 'container', attrs: {}, children: [shape] }, resolved.path, archive, content, location)
      if (['graphicFrame', 'grpSp'].includes(local(shape.name)) && !descendants(shape, 'tbl').length && !descendants(shape, 'txBody').length && !descendants(shape, 'pic').length) content.warnings.add('An unsupported slide object was omitted. Inspect the original presentation.')
    }
  }
}
