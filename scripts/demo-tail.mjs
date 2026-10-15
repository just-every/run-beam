// Test-host admission observation; emits no cookies, IP addresses or tokens.
import { appendFileSync, writeFileSync } from 'node:fs'
const [name, output] = process.argv.slice(2)
const account = process.env.CLOUDFLARE_ACCOUNT_ID
if (account !== 'b20c0ca9cab0c2b70e13d7cf724b89bd' || !name.endsWith('-demo-test--demo')) throw Error('Test host required')
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${name}/tails`
const headers = { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' }
const response = await fetch(endpoint, { method: 'POST', headers, body: '{}' })
const result = await response.json()
if (!result.success) throw Error(`Tail creation failed (${response.status})`)
const tail = result.result
const start = Date.now()
writeFileSync(output, JSON.stringify({ observingSince: new Date(start).toISOString() }) + '\n')
const socket = new WebSocket(tail.url, 'trace-v1')
socket.binaryType = 'arraybuffer'
let interrupted = false
socket.addEventListener('message', message => {
 const event = JSON.parse(typeof message.data === 'string' ? message.data : new TextDecoder().decode(message.data))
 for (const log of event.logs ?? []) for (const part of log.message ?? []) {
  let entry
  try { entry = typeof part === 'string' ? JSON.parse(part) : part } catch { continue }
  if (entry?.event === 'demo_admitted') appendFileSync(output, JSON.stringify({ at: log.timestamp, ...entry }) + '\n')
 }
})
socket.addEventListener('close', () => { interrupted = true })
try {
 await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(Error('Tail connection failed')), { once: true }) })
 await new Promise(resolve => setTimeout(resolve, 15 * 60 * 1000))
 appendFileSync(output, JSON.stringify({ observedUntil: new Date().toISOString(), uninterrupted: !interrupted }) + '\n')
 if (interrupted) throw Error('Tail interrupted; a fresh observation is required')
} finally {
 socket.close()
 const removed = await fetch(`${endpoint}/${tail.id}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(15_000) })
 if (!removed.ok) throw Error(`Tail removal failed (${removed.status})`)
}
// Cloudflare can leave the closed trace socket referenced after removal.
process.exit(0)
