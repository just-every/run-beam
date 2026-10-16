// Test-host admission observation; emits no cookies, IP addresses or tokens.
import { appendFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// Use Wrangler's transport: trace sockets require protocol pings while idle.
const WebSocket = createRequire(realpathSync(new URL('../node_modules/wrangler/package.json', import.meta.url)))('ws')
const [name, output] = process.argv.slice(2)
const account = process.env.CLOUDFLARE_ACCOUNT_ID
if (account !== 'b20c0ca9cab0c2b70e13d7cf724b89bd' || !name.endsWith('-demo-test--demo')) throw Error('Test host required')
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${name}/tails`
const headers = { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' }
const response = await fetch(endpoint, { method: 'POST', headers, body: '{}' })
const result = await response.json()
if (!result.success) throw Error(`Tail creation failed (${response.status})`)
const tail = result.result
const socket = new WebSocket(tail.url, 'trace-v1')
socket.binaryType = 'arraybuffer'
let timer, ping, stopping = false, disconnected, lastPong, pongs = 0
socket.on('pong', () => { lastPong = Date.now(); pongs++ })
socket.addEventListener('message', message => {
 const event = JSON.parse(typeof message.data === 'string' ? message.data : new TextDecoder().decode(message.data))
 for (const log of event.logs ?? []) for (const part of log.message ?? []) {
  let entry
  try { entry = typeof part === 'string' ? JSON.parse(part) : part } catch { continue }
  if (entry?.event === 'demo_admitted') appendFileSync(output, JSON.stringify({ at: log.timestamp, ...entry }) + '\n')
 }
})
socket.addEventListener('close', event => {
 if (stopping) return
 appendFileSync(output, JSON.stringify({ disconnectedAt: new Date().toISOString(), code: event.code }) + '\n')
 disconnected?.(Error('Tail interrupted; a fresh observation is required'))
})
try {
 await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(Error('Tail connection failed')), { once: true }) })
 writeFileSync(output, JSON.stringify({ observingSince: new Date().toISOString() }) + '\n')
 lastPong = Date.now()
 ping = setInterval(() => {
  if (Date.now() - lastPong > 30000) return socket.terminate()
  if (socket.readyState === WebSocket.OPEN) socket.ping('wrangler tail ping')
 }, 10000)
 await new Promise((resolve, reject) => { disconnected = reject; timer = setTimeout(resolve, 15 * 60 * 1000) })
 appendFileSync(output, JSON.stringify({ observedUntil: new Date().toISOString(), uninterrupted: true, pongs }) + '\n')
} finally {
 stopping = true
 clearInterval(ping)
 clearTimeout(timer)
 socket.close()
 const removed = await fetch(`${endpoint}/${tail.id}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(15_000) })
 if (!removed.ok) throw Error(`Tail removal failed (${removed.status})`)
}
// Cloudflare can leave the closed trace socket referenced after removal.
process.exit(0)
