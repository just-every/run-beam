// Untagged PDFs have positions, not table semantics. Only recover compact,
// repeated rectangular rows; leave irregular, rotated and flowing layouts for
// author review. Every text run belongs to exactly one output row and cell.
import type { SourceCell } from './source-content'

interface TextRun {
  str?: string; transform?: number[]; width?: number; height?: number; dir?: string
}
interface Run { text: string; x: number; y: number; right: number; height: number; order: number }
interface Cell { text: string; x: number; right: number }
interface Row { y: number; height: number; runs: Run[]; cells: Cell[] }
type Part = { kind: 'text'; text: string } | { kind: 'table'; table: SourceCell[][] }

function cells(runs: Run[]): Cell[] | null {
  const result: Cell[] = []
  let previous: Run | undefined
  for (const run of runs) {
    // Overprinted text is ambiguous: do not silently combine duplicate layers.
    if (previous && run.x < previous.right - Math.max(1, run.height * .15)) return null
    const gap = previous ? run.x - previous.right : 0
    if (!previous || gap > Math.max(12, run.height * 1.5, previous.height * 1.5)) {
      result.push({ text: run.text, x: run.x, right: run.right })
    } else {
      const cell = result[result.length - 1]
      const space = /\s$/.test(cell.text) || /^\s/.test(run.text) || gap > Math.min(run.height, previous.height) * .15
      cell.text += `${space ? ' ' : ''}${run.text}`
      cell.right = run.right
    }
    previous = run
  }
  return result.map(cell => ({ ...cell, text: cell.text.trim() }))
}

function compact(row: Row): boolean {
  return row.cells.length >= 2 && row.cells.length <= 30 && row.cells.every(cell => cell.text.length <= 100 && cell.text.split(/\s+/).length <= 10)
}

// Both left-aligned labels and right-aligned numbers are common. The whole
// column must share one of these edges, rather than drifting row by row.
function aligned(rows: Row[]): boolean {
  const tolerance = Math.max(2, Math.min(...rows.map(row => row.height)) * .3)
  return rows[0].cells.every((_, column) => {
    const left = rows.map(row => row.cells[column].x), right = rows.map(row => row.cells[column].right)
    return Math.max(...left) - Math.min(...left) <= tolerance || Math.max(...right) - Math.min(...right) <= tolerance
  })
}

function tableRows(rows: Row[]): boolean {
  if (rows.length < 3 || rows.length > 100 || !aligned(rows)) return false
  const gaps = rows.slice(1).map((row, index) => rows[index].y - row.y)
  const minimum = Math.min(...gaps), maximum = Math.max(...gaps)
  // A table needs visible separation between rows. Ordinary side-by-side
  // paragraph lines should not become cells merely because their edges align.
  const height = Math.max(...rows.map(row => row.height))
  return minimum >= height * 1.35 && maximum <= minimum * 1.35 && maximum <= height * 4
    && rows[0].cells.some((_, column) => rows.every(row => row.cells[column].text.length <= 40))
    && rows.every(row => row.cells.some(cell => cell.text.split(/\s+/).length <= 4))
    && rows[0].cells.slice(1).every((_, column) => Math.min(...rows.map(row => row.cells[column + 1].x))
      - Math.max(...rows.map(row => row.cells[column].right)) > Math.max(12, height * 1.5))
}

function adjacentIrregular(neighbor: Row | undefined, edge: Row, spacing: number): boolean {
  if (!neighbor || Math.abs(neighbor.y - edge.y) > spacing * 1.35) return false
  const left = edge.cells[0].x, right = edge.cells[edge.cells.length - 1].right
  // A nearby spanning or missing-cell row may be a merged cell. Do not claim
  // its surrounding rectangle as a complete simple table.
  return neighbor.cells.some(cell => cell.x < right && cell.right > left)
}

export function geometricPdfContent(items: TextRun[]): Part[] | null {
  const runs: Run[] = []
  for (const [order, item] of items.entries()) {
    if (typeof item.str !== 'string' || !item.str.trim()) continue
    const t = item.transform, width = item.width, height = item.height
    if (!t || t.length !== 6 || !t.every(Number.isFinite) || typeof width !== 'number' || typeof height !== 'number'
      || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
      || Math.max(...t.map(Math.abs), width, height) > 10_000_000
      || t[0] <= 0 || t[3] <= 0 || Math.abs(t[1]) > .02 || Math.abs(t[2]) > .02 || item.dir === 'rtl' || item.dir === 'ttb') return null
    runs.push({ text: item.str.replace(/\s+/g, ' '), x: t[4], y: t[5], right: t[4] + width, height, order })
  }
  if (!runs.length) return null
  runs.sort((a, b) => b.y - a.y || a.x - b.x || a.order - b.order)
  const rows: Row[] = []
  for (const run of runs) {
    const previous = rows.at(-1)
    if (previous && Math.abs(previous.y - run.y) <= Math.max(1, Math.min(previous.height, run.height) * .22)) {
      previous.runs.push(run)
      previous.height = Math.max(previous.height, run.height)
    } else rows.push({ y: run.y, height: run.height, runs: [run], cells: [] })
  }
  for (const row of rows) {
    row.runs.sort((a, b) => a.x - b.x || a.order - b.order)
    const grouped = cells(row.runs)
    if (!grouped) return null
    row.cells = grouped
  }
  const parts: Part[] = []
  let found = false, ambiguous = false, paragraph = ''
  const flush = () => { if (paragraph) parts.push({ kind: 'text', text: paragraph }); paragraph = '' }
  for (let start = 0; start < rows.length;) {
    const first = rows[start]
    let end = start + 1
    if (compact(first)) {
      while (end < rows.length && end - start <= 100 && compact(rows[end]) && rows[end].cells.length === first.cells.length
        && rows[end - 1].y - rows[end].y >= Math.max(first.height, rows[end].height) * 1.35
        && rows[end - 1].y - rows[end].y <= Math.max(first.height, rows[end].height) * 4
        && aligned(rows.slice(start, end + 1))) end++
    }
    const candidate = rows.slice(start, end)
    const spacing = candidate.length > 1 ? (first.y - candidate[candidate.length - 1].y) / (candidate.length - 1) : 0
    if (tableRows(candidate) && !adjacentIrregular(rows[start - 1], first, spacing)
      && !adjacentIrregular(rows[end], candidate[candidate.length - 1], spacing)) {
      flush()
      parts.push({ kind: 'table', table: candidate.map(row => row.cells.map(cell => ({ text: cell.text, colSpan: 1, rowSpan: 1, header: false }))) })
      found = true
      start = end
    } else {
      // Unresolved side-by-side text could be prose columns or merged cells;
      // top-to-bottom interleaving would claim a reading order we do not know.
      if (first.cells.length > 1) ambiguous = true
      const previous = rows[start - 1]
      const separation = previous && previous.y - first.y > Math.max(previous.height, first.height) * 1.8 ? '\n\n' : '\n'
      paragraph += `${paragraph ? separation : ''}${first.cells.map(cell => cell.text).join(' ')}`
      start++
    }
  }
  flush()
  return found && !ambiguous ? parts : null
}
