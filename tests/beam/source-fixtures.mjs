import { zip, syntheticImage } from './fixtures.mjs'
import { deflateSync } from 'node:zlib'

// A real deflated Office Open XML document. The foreign URL is document data,
// never a resource the extractor may fetch. All application behavior uses HTTP.
export const sourceDocx = body => zip([
  ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
  ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
  ['word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr/></w:body></w:document>`],
  ['word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/probe.png"/><Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://untrusted.example.test/procedure" TargetMode="External"/></Relationships>'],
  ['word/media/probe.png', syntheticImage],
])
export const sourceParagraph = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const heading = text => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
const document = sourceDocx, paragraph = sourceParagraph
export const sourceProcedureDocx = document(heading('Prepare the station') + paragraph('Wash hands &amp; inspect tools.') + '<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>' + paragraph('Tool') + '</w:tc><w:tc>' + paragraph('Condition') + '</w:tc></w:tr><w:tr><w:tc>' + paragraph('Probe') + '</w:tc><w:tc>' + paragraph('Clean') + '</w:tc></w:tr></w:tbl>' + '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Diagram" descr="Probe position"/><a:graphic><a:graphicData><a:blip r:embed="rIdImage"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>' + heading('Close the station') + paragraph('&lt;script&gt;do not execute&lt;/script&gt; Store tools.'))

// Same rectangular merge in both Office formats: a two-column heading and a
// two-by-two body cell, followed by independent cells to prove grid alignment.
const mergedWordCell = (text, properties = '') => `<w:tc><w:tcPr>${properties}</w:tcPr>${paragraph(text)}</w:tc>`
export const sourceMergedDocx = document(heading('Prepare') + paragraph('Inspect the probe.') + '<w:tbl><w:tblGrid>' + '<w:gridCol w:w="1000"/>'.repeat(4) + '</w:tblGrid>' +
  '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + mergedWordCell('Equipment', '<w:gridSpan w:val="2"/>') + mergedWordCell('Condition') + mergedWordCell('Action') + '</w:tr>' +
  '<w:tr>' + mergedWordCell('Probe', '<w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>') + mergedWordCell('Clean') + mergedWordCell('Inspect') + '</w:tr>' +
  '<w:tr>' + mergedWordCell('', '<w:gridSpan w:val="2"/><w:vMerge/>') + mergedWordCell('Ready') + mergedWordCell('Store') + '</w:tr></w:tbl>')

// Same grid as sourceMergedDocx, encoded as physical legacy hMerge cells.
// Both explicit and implicit continuation values occur in actual Word XML.
export function sourceLegacyMergedDocx(continuationText = '') {
  return document(heading('Prepare') + paragraph('Inspect the probe.') + '<w:tbl><w:tblGrid>' + '<w:gridCol w:w="1000"/>'.repeat(4) + '</w:tblGrid>' +
    '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + mergedWordCell('Equipment', '<w:hMerge w:val="restart"/>') + mergedWordCell('', '<w:hMerge w:val="continue"/>') + mergedWordCell('Condition') + mergedWordCell('Action') + '</w:tr>' +
    '<w:tr>' + mergedWordCell('Probe', '<w:hMerge w:val="restart"/><w:vMerge w:val="restart"/>') + mergedWordCell(continuationText, '<w:hMerge/><w:vMerge w:val="restart"/>') + mergedWordCell('Clean') + mergedWordCell('Inspect') + '</w:tr>' +
    '<w:tr>' + mergedWordCell('', '<w:hMerge w:val="restart"/><w:vMerge/>') + mergedWordCell('', '<w:hMerge/><w:vMerge w:val="continue"/>') + mergedWordCell('Ready') + mergedWordCell('Store') + '</w:tr></w:tbl>')
}

export function sourceProcedurePptx(merged = false) {
  const cell = (text, attributes = '') => `<a:tc ${attributes}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`
  const mergedTable = '<a:tbl><a:tblPr firstRow="true"/><a:tblGrid>' + '<a:gridCol w="1000"/>'.repeat(4) + '</a:tblGrid>' +
    '<a:tr h="1000">' + cell('Equipment', 'gridSpan="2"') + cell('', 'hMerge="true"') + cell('Condition') + cell('Action') + '</a:tr>' +
    '<a:tr h="1000">' + cell('Probe', 'gridSpan="2" rowSpan="2"') + cell('', 'hMerge="true" rowSpan="2"') + cell('Clean') + cell('Inspect') + '</a:tr>' +
    '<a:tr h="1000">' + cell('', 'gridSpan="2" vMerge="true"') + cell('', 'hMerge="true" vMerge="true"') + cell('Ready') + cell('Store') + '</a:tr></a:tbl>'

  const shape = (title, body) => `<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>`
  const slide = body => `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
  return zip([
    ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'],
    ['ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="second"/><p:sldId id="257" r:id="first"/></p:sldIdLst></p:presentation>'],
    ['ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="first" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="second" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>'],
    ['ppt/slides/slide1.xml', slide(shape('Close', 'Store the clean probe.'))],
    ['ppt/slides/slide2.xml', slide(shape('Prepare', 'Inspect the probe.') + '<p:graphicFrame><a:graphic><a:graphicData>' + (merged ? mergedTable : '<a:tbl><a:tblPr firstRow="1"/><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Tool</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Condition</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl>') + '</a:graphicData></a:graphic></p:graphicFrame><p:pic><p:nvPicPr><p:cNvPr id="3" name="Probe" descr="Probe placement"/></p:nvPicPr><p:blipFill><a:blip r:embed="image"/></p:blipFill></p:pic>')],
    ['ppt/slides/_rels/slide2.xml.rels', '<Relationships><Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/probe.png"/></Relationships>'],
    ['ppt/media/probe.png', syntheticImage],
  ])
}
export const sourceProcedureHtml = `<html><head><title>Ignored metadata</title><script>neverRead()</script></head><body><h1>Prepare</h1><p>Wash &amp; inspect.</p><table><tr><th rowspan="2">Tool</th><th>Condition</th></tr><tr><td>Clean</td></tr></table><img alt="Probe placement" src="data:image/png;base64,${syntheticImage.toString('base64')}"><h2>Close</h2><p>Store tools.</p><iframe src="https://untrusted.example.test/frame"></iframe><img alt="External diagram" src="https://untrusted.example.test/image.png"></body></html>`

// A genuine raster-only PDF page, with readable bitmap text CHECK PROBE.
// It cannot qualify OCR; it proves that a scan is retained and honestly blocked.
export function sourceProcedurePdf(scan = false) {
  const width = 180, height = 35, samples = Buffer.alloc(width * height * 3, 255)
  const glyphs = { C: ['01111','10000','10000','10000','10000','10000','01111'], H: ['10001','10001','10001','11111','10001','10001','10001'], E: ['11111','10000','10000','11110','10000','10000','11111'], K: ['10001','10010','10100','11000','10100','10010','10001'], P: ['11110','10001','10001','11110','10000','10000','10000'], R: ['11110','10001','10001','11110','10100','10010','10001'], O: ['01110','10001','10001','10001','10001','10001','01110'], B: ['11110','10001','10001','11110','10001','10001','11110'] }
  for (const [index, letter] of [...'CHECK PROBE'].entries()) for (const [y, row] of (glyphs[letter] ?? []).entries()) for (const [x, pixel] of [...row].entries()) if (pixel === '1') for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) samples.fill(0, ((5 + y * 2 + dy) * width + 5 + index * 14 + x * 2 + dx) * 3, ((5 + y * 2 + dy) * width + 5 + index * 14 + x * 2 + dx) * 3 + 3)
  const stream = (data, dictionary = '') => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')])
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Count 1 /Kids [3 0 R] >>'), Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 150] /Resources ${scan ? '<< /XObject << /Scan 5 0 R >> >>' : '<< /Font << /F1 5 0 R >> >>'} /Contents 4 0 R >>`), stream(Buffer.from(scan ? 'q 360 0 0 70 20 50 cm /Scan Do Q' : 'BT /F1 18 Tf 20 100 Td (Inspect the clean probe.) Tj ET')), scan ? stream(deflateSync(samples), `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`) : Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')]
  return pdfObjects(objects)
}

// Ordinary untagged PDF: the table is represented by repeated real text coordinates.
export function sourceUntaggedTablePdf() {
  const runs = [[20,220,18,'Opening inspection'],[20,190,12,'Inspect the clean probe.'],[20,130,12,'Tool'],[200,130,12,'Condition'],[20,105,12,'Probe'],[200,105,12,'Clean'],[20,80,12,'Gloves'],[200,80,12,'Intact'],[20,35,12,'Record the inspection before starting.']]
  const stream = Buffer.from(runs.map(([x,y,size,text])=>`BT /F1 ${size} Tf ${x} ${y} Td (${text}) Tj ET`).join('\n'))
  return pdfObjects(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 250] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),stream,Buffer.from('\nendstream')]),'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'].map(value=>Buffer.isBuffer(value)?value:Buffer.from(value)))
}

export function sourceTaggedPdf() {
  const runs = ['Prepare the station', 'Inspect the clean probe.', 'Tool', 'Condition', 'Probe', 'Clean']
  const stream = Buffer.from(runs.map((text, index) => `/Span << /MCID ${index} >> BDC BT /F1 ${index ? 12 : 18} Tf ${index === 3 || index === 5 ? 180 : 20} ${index < 2 ? 130 - index * 25 : index < 4 ? 70 : 45} Td (${text}) Tj ET EMC`).join('\n'))
  return pdfObjects([
    '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 6 0 R /MarkInfo << /Marked true >> >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 160] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /StructParents 0 >>',
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /StructTreeRoot /K [7 0 R 8 0 R 9 0 R] /ParentTree 16 0 R /ParentTreeNextKey 1 >>',
    '<< /Type /StructElem /S /H1 /P 6 0 R /Pg 3 0 R /K 0 >>',
    '<< /Type /StructElem /S /P /P 6 0 R /Pg 3 0 R /K 1 >>',
    '<< /Type /StructElem /S /Table /P 6 0 R /K [10 0 R 11 0 R] >>',
    '<< /Type /StructElem /S /TR /P 9 0 R /K [12 0 R 13 0 R] >>',
    '<< /Type /StructElem /S /TR /P 9 0 R /K [14 0 R 15 0 R] >>',
    '<< /Type /StructElem /S /TH /P 10 0 R /Pg 3 0 R /K 2 >>',
    '<< /Type /StructElem /S /TH /P 10 0 R /Pg 3 0 R /K 3 >>',
    '<< /Type /StructElem /S /TD /P 11 0 R /Pg 3 0 R /K 4 >>',
    '<< /Type /StructElem /S /TD /P 11 0 R /Pg 3 0 R /K 5 >>',
    '<< /Nums [0 [7 0 R 8 0 R 12 0 R 13 0 R 14 0 R 15 0 R]] >>',
  ].map(object => Buffer.isBuffer(object) ? object : Buffer.from(object)))
}

function pdfObjects(objects) {
  const parts = [Buffer.from('%PDF-1.4\n')], offsets = []; let length = parts[0].length
  for (const [index, object] of objects.entries()) { offsets.push(length); const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); parts.push(part); length += part.length }
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`))
  return Buffer.concat(parts)
}

