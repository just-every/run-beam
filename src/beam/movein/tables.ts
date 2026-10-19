// Bounded readers for the two table formats incumbent LMS reports use:
// RFC 4180 CSV and Office Open XML workbooks (.xlsx, a ZIP of XML parts).
import { inflateRawSync } from 'node:zlib'
import { insist } from '../core'

export type Table = { name: string; rows: string[][] }

export function readCsv(bytes: Uint8Array, name = 'csv'): Table {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { insist(false, 'csv_not_utf8') }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index++ }
      else if (character === '"') quoted = false
      else field += character
    } else if (character === '"' && field === '') quoted = true
    else if (character === ',') { row.push(field); field = '' }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += character
  }
  insist(!quoted, 'csv_unterminated_quote')
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  insist(rows.length <= 100_000, 'csv_too_many_rows')
  return { name, rows: rows.filter(cells => cells.some(cell => cell.trim() !== '')) }
}

const UNZIPPED_LIMIT = 50_000_000

function inflate(data: Uint8Array, expected: number): Uint8Array {
  insist(expected > 0 && expected <= UNZIPPED_LIMIT, 'xlsx_entry_size')
  // workerd needs one byte of EOF headroom (cloudflare/workerd#6286).
  // The exact-length check below still enforces the declared ZIP size.
  const out = inflateRawSync(data, { maxOutputLength: expected + 1 })
  insist(out.length === expected, 'xlsx_entry_size')
  return out
}

function unzip(bytes: Uint8Array): Map<string, () => Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index--) if (view.getUint32(index, true) === 0x06054b50) { end = index; break }
  insist(end >= 0, 'xlsx_not_zip')
  const count = view.getUint16(end + 10, true)
  let pointer = view.getUint32(end + 16, true)
  insist(count <= 2000, 'xlsx_too_many_entries')
  const entries = new Map<string, () => Uint8Array>()
  let declared = 0
  for (let entry = 0; entry < count; entry++) {
    insist(pointer + 46 <= bytes.length && view.getUint32(pointer, true) === 0x02014b50, 'xlsx_corrupt')
    const method = view.getUint16(pointer + 10, true), compressed = view.getUint32(pointer + 20, true), size = view.getUint32(pointer + 24, true)
    const nameLength = view.getUint16(pointer + 28, true), extra = view.getUint16(pointer + 30, true), comment = view.getUint16(pointer + 32, true), local = view.getUint32(pointer + 42, true)
    const name = new TextDecoder().decode(bytes.slice(pointer + 46, pointer + 46 + nameLength))
    declared += size
    insist(declared <= UNZIPPED_LIMIT, 'xlsx_too_large')
    insist(local + 30 <= bytes.length && view.getUint32(local, true) === 0x04034b50, 'xlsx_corrupt')
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    insist(start + compressed <= bytes.length, 'xlsx_corrupt')
    const data = bytes.slice(start, start + compressed)
    insist(method === 0 || method === 8, 'xlsx_compression')
    entries.set(name, () => method === 0 ? (insist(compressed === size, 'xlsx_corrupt'), data) : inflate(data, size))
    pointer += 46 + nameLength + extra + comment
  }
  return entries
}

const decodeXml = (value: string) => value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity: string) => entity === 'amp' ? '&' : entity === 'lt' ? '<' : entity === 'gt' ? '>' : entity === 'quot' ? '"' : entity === 'apos' ? "'" : String.fromCodePoint(entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))))
const attribute = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map(match => decodeXml(match[1] ?? '')).join('')

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? ''
  insist(letters, 'xlsx_cell_reference')
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1
}

/** Every sheet of a workbook as rows of cell text. Numeric cells keep their stored value. */
export function readXlsx(bytes: Uint8Array): Table[] {
  const entries = unzip(bytes)
  const text = (name: string) => { const entry = entries.get(name); return entry ? new TextDecoder().decode(entry()) : null }
  const workbook = text('xl/workbook.xml')
  insist(workbook, 'xlsx_no_workbook')
  const relations = new Map([...(text('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)].map(match => [attribute(match[0], 'Id'), attribute(match[0], 'Target')]))
  const shared = [...(text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(match => texts(match[1]))
  const tables: Table[] = []
  for (const sheet of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const target = relations.get(attribute(sheet[0], 'r:id'))
    insist(target, 'xlsx_sheet_missing')
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    const xml = text(path)
    insist(xml, 'xlsx_sheet_missing')
    const rows: string[][] = []
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = []
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const reference = attribute(cell[0], 'r'), type = attribute(cell[0], 't'), body = cell[2] ?? ''
        const index = reference ? columnIndex(reference) : cells.length
        insist(index < 500, 'xlsx_too_many_columns')
        const raw = decodeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '')
        const value = type === 's' ? shared[Number(raw)] ?? '' : type === 'inlineStr' ? texts(body) : type === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE') : raw
        while (cells.length < index) cells.push('')
        cells[index] = value
      }
      rows.push(cells)
      insist(rows.length <= 100_000, 'xlsx_too_many_rows')
    }
    tables.push({ name: decodeXml(attribute(sheet[0], 'name') ?? ''), rows: rows.filter(cells => cells.some(cell => cell.trim() !== '')) })
  }
  return tables
}
