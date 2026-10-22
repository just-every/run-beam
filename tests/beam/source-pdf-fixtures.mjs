// Synthetic, readable PDFs with genuine marked content and authored structure.
// They enter tests through Sources; no parser or application behavior is faked.
export const taggedReorderedPdf = () => taggedDocument({ reordered: true })
export const taggedMergedPdf = () => taggedDocument({ merged: true })
export const taggedCoveredRowPdf = () => taggedDocument({ merged: true, coveredRow: true })
export const taggedInvalidSpanPdf = () => taggedDocument({ merged: true, invalidSpan: true })
export const taggedCoveragePdf = (coverage = 'missing') => taggedDocument({ coverage })

function taggedDocument({ reordered = false, merged = false, coveredRow = false, invalidSpan = false, coverage } = {}) {
  if (coverage && !['missing', 'duplicate', 'unmarked'].includes(coverage)) throw new Error('Unknown coverage fixture')
  const objects = [], add = value => (objects.push(value), objects.length), ref = id => `${id} 0 R`
  const catalog = add(''), pages = add(''), page = add(''), content = add('')
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'), root = add('')
  const heading = add(''), paragraph = add(''), table = add(''), parentTree = add('')
  const runs = [{ text: 'Prepare', x: 30, y: 310, size: 18 }, { text: 'Inspect the clean probe.', x: 30, y: 275, size: 12 }]
  const parents = [heading, paragraph]
  const header = (text, colSpan = 1) => ({ text, colSpan, header: true })
  const cell = (text, colSpan = 1, rowSpan = 1) => ({ text, colSpan, rowSpan })
  const rows = merged ? [
    [header('Equipment', 2), header('Condition'), header('Action')],
    [cell('Probe', 2, invalidSpan ? 4 : 2), cell('Clean', 1, coveredRow ? 2 : 1), cell('Inspect', 1, coveredRow ? 2 : 1)],
    coveredRow ? [] : [cell('Ready'), cell('Store')],
  ] : [
    [header('Equipment'), header('Condition'), header('Action')],
    [cell('Probe'), cell('Clean'), cell('Inspect')],
    [cell('Gloves'), cell('Ready'), cell('Store')],
  ]
  const rowIds = rows.map(() => add(''))
  for (const [rowIndex, row] of rows.entries()) {
    const ids = []
    let column = merged && rowIndex === 2 ? 2 : 0
    for (const value of row) {
      const id = add(''), mcid = runs.length
      ids.push(id); parents.push(id)
      runs.push({ text: value.text, x: 30 + column * (merged ? 140 : 200), y: 225 - rowIndex * 30, size: 12 })
      const spans = `${value.colSpan > 1 ? ` /ColSpan ${value.colSpan}` : ''}${value.rowSpan > 1 ? ` /RowSpan ${value.rowSpan}` : ''}`
      objects[id - 1] = `<< /Type /StructElem /S /${value.header ? 'TH' : 'TD'} /P ${ref(rowIds[rowIndex])} /Pg ${ref(page)} /K ${mcid}${spans ? ` /A << /O /Table${spans} >>` : ''} >>`
      column += value.colSpan
    }
    objects[rowIds[rowIndex] - 1] = `<< /Type /StructElem /S /TR /P ${ref(table)} /K [${ids.map(ref).join(' ')}] >>`
  }
  if (coverage === 'missing') runs.push({ text: 'Retain this unreferenced passage.', x: 30, y: 75, size: 12 })
  const paint = runs.map((_, index) => index)
  if (reordered) paint.reverse()
  const operators = paint.map(index => {
    const { text, x, y, size } = runs[index]
    return `/Span << /MCID ${index} >> BDC BT /F1 ${size} Tf ${x} ${y} Td (${text}) Tj ET EMC`
  })
  if (coverage === 'unmarked') operators.push('BT /F1 12 Tf 30 75 Td (Retain this unmarked passage.) Tj ET')
  const stream = Buffer.from(operators.join('\n'))
  objects[content - 1] = Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')])
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${ref(pages)} /StructTreeRoot ${ref(root)} /MarkInfo << /Marked true >> >>`
  objects[pages - 1] = `<< /Type /Pages /Count 1 /Kids [${ref(page)}] >>`
  objects[page - 1] = `<< /Type /Page /Parent ${ref(pages)} /MediaBox [0 0 650 350] /Resources << /Font << /F1 ${ref(font)} >> >> /Contents ${ref(content)} /StructParents 0 >>`
  objects[root - 1] = `<< /Type /StructTreeRoot /K [${[heading, paragraph, table].map(ref).join(' ')}] /ParentTree ${ref(parentTree)} /ParentTreeNextKey 1 >>`
  objects[heading - 1] = `<< /Type /StructElem /S /H1 /P ${ref(root)} /Pg ${ref(page)} /K 0 >>`
  objects[paragraph - 1] = `<< /Type /StructElem /S /P /P ${ref(root)} /Pg ${ref(page)} /K ${coverage === 'duplicate' ? '[1 1]' : '1'} >>`
  objects[table - 1] = `<< /Type /StructElem /S /Table /P ${ref(root)} /K [${rowIds.map(ref).join(' ')}] >>`
  objects[parentTree - 1] = `<< /Nums [0 [${parents.map(ref).join(' ')}]] >>`
  return pdfObjects(objects)
}

function pdfObjects(objects) {
  const parts = [Buffer.from('%PDF-1.7\n')], offsets = []
  let length = parts[0].length
  for (const [index, object] of objects.entries()) {
    offsets.push(length)
    const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.isBuffer(object) ? object : Buffer.from(object), Buffer.from('\nendobj\n')])
    parts.push(part); length += part.length
  }
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`))
  return Buffer.concat(parts)
}
