// Public offline door: pnpm run diagnose:configuration < exports/configuration.json
// No environment files are discovered and no credential/provider is contacted.
import { configurationIssues } from './installer/configuration.mjs'

process.stdin.setEncoding('utf8')
let input = ''
try {
  for await (const chunk of process.stdin) {
    input += chunk
    if (Buffer.byteLength(input, 'utf8') > 64 * 1024) throw Error()
  }
  const env = JSON.parse(input)
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw Error()
  const issues = configurationIssues(env)
  console.log(JSON.stringify({ status: issues.length ? 'invalid_configuration' : 'configuration_valid', verification: 'offline syntax only; provider credentials and sender ownership have not been verified', issues }))
  process.exitCode = issues.length ? 1 : 0
} catch {
  console.log(JSON.stringify({ status: 'invalid_input', action: 'Supply one JSON object of installation settings on standard input (at most 64 KiB); keep its file private.' }))
  process.exitCode = 1
}
