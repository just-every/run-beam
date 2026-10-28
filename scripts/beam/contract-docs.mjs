// CONTRACT.md owns statuses and evidence; preserve the established acceptance journeys.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const [mode, ...selected] = process.argv.slice(2)
if (!['write', 'check'].includes(mode)) throw Error('Usage: contract-docs.mjs write|check [CLAUSE ...]')
const read = path => readFileSync(path, 'utf8')
const source = read('CONTRACT.md')
const rows = source.split('\n').filter(line => /^\| `[^`]+` \|/.test(line)).map(line => line.split(' | '))
const ids = new Set(selected)
for (const id of ids) if (!rows.some(row => row[0] === `| \`${id}\``)) throw Error(`Unknown clause ${id}`)
const byId = new Map(rows.map(row => [row[0].slice(3, -1), row]))
let acceptance = read('ACCEPTANCE.md').split('\n').map(line => {
  const cells = line.split(' | '), row = byId.get(cells[0]?.slice(2))
  if (!row || (ids.size && !ids.has(cells[0].slice(2)))) return line
  return [cells[0], cells[1], row[4], row[3], row[5]].join(' | ')
}).join('\n')
const count = predicate => ['done', 'partial', 'missing'].map(status => rows.filter(row => predicate(row) && row[3] === status).length)
const summary = (label, predicate) => `| ${label} | ${count(predicate).join(' | ')} | ${rows.filter(predicate).length} |`
const contract = source.replace(/^\| Published \|.*$/m, summary('Published', row => row[2] === 'published'))
  .replace(/^\| Target and push further \|.*$/m, summary('Target and push further', row => row[2] !== 'published'))
  .replace(/^\| All \|.*$/m, summary('All', () => true))
const claims = '# Beam implementation claims\n\nGenerated from CONTRACT.md. The source retains all acceptance obligations and judgments.\n\n| Clause | Title | Kind | Status | Evidence | Gap |\n| --- | --- | --- | --- | --- | --- |\n' + rows.map(row => row.join(' | ')).join('\n') + '\n'
for (const [path, expected] of [['CONTRACT.md', contract], ['ACCEPTANCE.md', acceptance], ['docs/CLAIMS.md', claims]]) {
  if (mode === 'write') writeFileSync(path, expected)
  else if (!existsSync(path) || read(path) !== expected) throw Error(`Stale generated contract view: ${path}`)
}
console.log(`Contract views ${mode === 'write' ? 'regenerated' : 'current'}; ${rows.length} clauses`)
