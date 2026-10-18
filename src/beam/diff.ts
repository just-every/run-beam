// Line comparison for course and source history: the longest common subsequence
// of lines after trimming the shared head and tail. Texts whose changed middle
// is too large to compare line by line say so instead of guessing.
export type DiffLine = { op: 'same' | 'add' | 'del'; text: string }
export type LineDiff = { changed: boolean; lines: DiffLine[] } | { changed: true; tooLarge: true }

const CELLS = 4_000_000

export function diffLines(before: string, after: string): LineDiff {
  if (before === after) return { changed: false, lines: before ? before.split('\n').map(text => ({ op: 'same', text })) : [] }
  const a = before ? before.split('\n') : [], b = after ? after.split('\n') : []
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const x = a.slice(head, a.length - tail), y = b.slice(head, b.length - tail)
  if ((x.length + 1) * (y.length + 1) > CELLS) return { changed: true, tooLarge: true }
  const width = y.length + 1
  const table = new Uint32Array((x.length + 1) * width)
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--)
    table[i * width + j] = x[i] === y[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
  const middle: DiffLine[] = []
  let i = 0, j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { middle.push({ op: 'same', text: x[i] }); i++; j++ }
    else if (i < x.length && (j === y.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) middle.push({ op: 'del', text: x[i++] })
    else middle.push({ op: 'add', text: y[j++] })
  }
  return { changed: true, lines: [...a.slice(0, head).map(text => ({ op: 'same' as const, text })), ...middle, ...a.slice(a.length - tail).map(text => ({ op: 'same' as const, text }))] }
}
