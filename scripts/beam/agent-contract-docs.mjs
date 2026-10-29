import { readFileSync, writeFileSync } from 'node:fs'
import { parseContract } from '../../src/base/seed-contract.mjs'

const [mode, ...args] = process.argv.slice(2)
if (!['write', 'check'].includes(mode) || (args.length && (args.length !== 2 || args[0] !== '--clauses'))) {
  throw Error('Usage: node scripts/beam/agent-contract-docs.mjs write|check [--clauses ID,ID]')
}
const source = readFileSync('CONTRACT.md', 'utf8'), lines = source.split('\n')
const clauses = parseContract(source).clauses.filter(clause => /^(BASE-AGENT|SURFACE)-\d{3}$/.test(clause.id))
if (!clauses.length) throw Error('No agent surface clauses found')
for (const id of args[1]?.split(',') ?? []) {
  if (!clauses.some(clause => clause.id === id)) throw Error('Touched clause is outside the agent acceptance view: ' + id)
}
const before = readFileSync('ACCEPTANCE.md', 'utf8'), marker = '## Agent surface adoption\n'
const start = before.indexOf(marker)
if (start < 0 || before.indexOf('\n## ', start + marker.length) !== -1) throw Error('Keep the agent adoption view as the final acceptance section')
const rows = clauses.map(clause => {
  const cells = lines[clause.row - 1].trim().slice(1, -1).split(/(?<!\\)\|/).map(cell => cell.trim())
  return `| ${clause.id} | ${cells[1]}: every numbered acceptance point in CONTRACT.md. | ${clause.status} | ${cells[4]} | ${cells[5]} |`
})
const section = [
  marker.trimEnd(),
  '<!-- Generated from CONTRACT.md by scripts/beam/agent-contract-docs.mjs. -->',
  'The declared Core preparation surface has the evidence and remaining work below. Native clause judgments elsewhere do not prove omitted MCP adapters. CONTRACT.md owns each status, evidence line and gap; this view never promotes a clause.',
  '| Clause | Required acceptance | Status | Evidence | Remaining work |',
  '| --- | --- | --- | --- | --- |',
  ...rows,
].join('\n\n').replaceAll('|\n\n|', '|\n|') + '\n'
const output = before.slice(0, start) + section
if (mode === 'check' && output !== before) throw Error('Agent acceptance rows are stale; run agent-contract-docs.mjs write')
if (mode === 'write' && output !== before) writeFileSync('ACCEPTANCE.md', output)
console.log(mode === 'check' ? 'Agent acceptance rows are current.' : 'Generated agent acceptance rows from CONTRACT.md.')
