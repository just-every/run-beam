// Documented-shape fixtures for the TalentLMS kit: a course list CSV and a
// course report workbook (users overview plus timeline), written as a real
// deflate-compressed .xlsx. TalentLMS's help describes these exports' contents
// but not exact header spellings; real export fidelity is an owner-data trial.
import { deflateRawSync, crc32 } from 'node:zlib'

export const courseListCsv = [
  'ID,Course,Code,Category',
  '101,"Opening the clinic, safely",OPEN-1,Front desk',
  '102,Handling client records,REC-2,Privacy',
].join('\r\n') + '\r\n'

const xml = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const column = index => String.fromCharCode(65 + index)

function sheet(rows, strings) {
  const cell = (value, r, c) => typeof value === 'number'
    ? `<c r="${column(c)}${r}"><v>${value}</v></c>`
    : `<c r="${column(c)}${r}" t="s"><v>${strings.indexOf(value) >= 0 ? strings.indexOf(value) : strings.push(value) - 1}</v></c>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => value === '' ? '' : cell(value, r + 1, c)).join('')}</row>`).join('')}</sheetData></worksheet>`
}

export function zip(files) {
  const locals = [], centrals = []
  let offset = 0
  for (const [name, text] of files) {
    const data = Buffer.from(text), packed = deflateRawSync(data), nameBytes = Buffer.from(name), crc = crc32(data)
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, packed); centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + packed.length
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

export function workbook(sheets) {
  const strings = []
  const parts = sheets.map(([, rows], index) => [`xl/worksheets/sheet${index + 1}.xml`, sheet(rows, strings)])
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${parts.map(([name]) => `<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([name], index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`],
    ...parts,
    ['xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(value => `<si><t xml:space="preserve">${xml(value)}</t></si>`).join('')}</sst>`],
  ])
}

/** A course report for course 101: one learner known to Beam, one unknown, one not completed, one row repeated in the timeline, one earlier completion only in the timeline. */
export function courseReport({ learnerEmail }) {
  return workbook([
    ['Users', [
      ['User', 'Email', 'Progress', 'Completion date', 'Score'],
      ['Sam Lee', learnerEmail, '100%', '14/03/2025', 90],
      ['Jo Former', 'jo.former@example.test', '100%', 45740, 75],
      ['Kim New', 'kim.new@example.test', '40%', '', ''],
      ['Max Unclear', 'max@example.test', '100%', '31/31/2025', ''],
    ]],
    ['Timeline', [
      ['Date', 'User', 'Email', 'Event'],
      ['14/03/2025 10:42', 'Sam Lee', learnerEmail, 'Completed the course'],
      ['02/02/2024 09:00', 'Sam Lee', learnerEmail, 'Completed the course'],
      ['01/02/2024 08:00', 'Sam Lee', learnerEmail, 'Started the course'],
    ]],
  ])
}

// Minimal real file signatures for upload custody checks.
export const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
export const procedureV1 = 'Opening procedure v1\n\n1. Disarm the alarm.\n2. Check the fridge log.\n'
export const procedureV2 = 'Opening procedure v2\n\n1. Disarm the alarm.\n2. Check the fridge log and record the temperature.\n'
