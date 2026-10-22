// Runs the built Worker (dist/) in Miniflare with its own D1 and R2 state in a
// temporary directory, configured as a hosted installation that mails through
// Resend. The only fake is at the network edge: the Resend request is captured
// and answered with a receipt, and any other outbound request fails.
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(await realpath(join(root, 'node_modules/wrangler/package.json')))
const { Miniflare, convertV4MiniflareOptions } = require('miniflare')
const { unstable_splitSqlQuery: splitSql } = require('wrangler')

async function freePort() {
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const { port } = socket.address()
  await new Promise(resolve => socket.close(resolve))
  return port
}

export async function emittedWorker({ bindings = {}, checkout = process.env.BEAM_WORKER_CHECKOUT, outboundService, directWorker = false } = {}) {
  // OPS-007: run the identical public-door qualification against an unchanged historical producer or the candidate.
  const workerRoot = checkout || root
  const directory = await mkdtemp(join(tmpdir(), 'beam-worker-'))
  const server = join(workerRoot, 'dist/server')
  const config = JSON.parse(await readFile(join(server, 'wrangler.json'), 'utf8'))
  const port = await freePort()
  const origin = `https://127.0.0.1:${port}`
  const secret = () => randomBytes(32).toString('base64url')
  const vars = { AUTH_ORIGIN: origin, OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: secret(), SETUP_TOKEN: secret(), MAIL_PROVIDER: 'resend', MAIL_FROM: 'Beam <auth@example.test>', MAIL_API_KEY: secret(), ...bindings }
  // `edge.refuse` makes the provider refuse every message, as Resend does a message it will not accept.
  const mails = [], edge = { refuse: false, attempts: [], webhooks: [], webhookStatus: 204 }
  const options = convertV4MiniflareOptions({
    host: '127.0.0.1', port, https: true, modulesRoot: server,
    modules: [config.main, ...(await readdir(join(server, 'assets'))).filter(name => name.endsWith('.js')).map(name => `assets/${name}`)].map(name => ({ type: 'ESModule', path: join(server, name) })),
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    assets: { directory: join(workerRoot, 'dist/client'), routerConfig: { has_user_worker: true } },
    d1Databases: { DB: 'beam-tests' }, r2Buckets: { FILES: 'beam-tests-files' },
    bindings: vars,
    outboundService: async request => {
      if (outboundService) { const response = await outboundService(request.clone(), { mails, edge }); if (response) return response }
      if (request.url === 'https://synthetic-beam-1.example.test/hooks') {
        edge.webhooks.push({ url: request.url, headers: Object.fromEntries(request.headers), body: await request.text() })
        return new Response(null, { status: edge.webhookStatus, headers: edge.webhookStatus === 302 ? { location: 'http://127.0.0.1/private' } : {} })
      }
      if (request.url !== 'https://api.resend.com/emails') throw new Error(`Unexpected test network destination ${new URL(request.url).origin}`)
      const message = await request.json()
      edge.attempts.push(message)
      if (edge.refuse) return Response.json({ name: 'validation_error', message: 'Refused at the test edge' }, { status: 422 })
      mails.push(message)
      return Response.json({ id: `test-receipt-${mails.length}` })
    },
  })
  const mf = new Miniflare({ ...options, resourcePersistencePath: join(directory, 'state') })
  const close = async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }) }
  try {
    await mf.ready
    const db = await mf.getD1Database('DB')
    const migrations = join(workerRoot, 'migrations/core')
    for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
      for (const statement of splitSql(await readFile(join(migrations, name), 'utf8'))) await db.prepare(statement).run()
    }
  } catch (error) { await close(); throw error }
  /** Requests reach the Worker directly; a relative path resolves against the origin. */
  const fetch = async (input, init = {}) => {
    // Miniflare bundles its own undici, so forms travel as the bytes Node encodes for them.
    if (init.body instanceof FormData || init.body instanceof URLSearchParams) {
      const encoded = new Response(init.body)
      init = { ...init, body: new Uint8Array(await encoded.arrayBuffer()), headers: { 'content-type': encoded.headers.get('content-type'), ...init.headers } }
    }
    // A live LTI relay must retain its real public issuer/Host. The service-binding
    // transport calls the identical built Worker without the dev HTTP proxy's URL rewriting.
    if (directWorker) return (await mf.getWorker()).fetch(new URL(input, origin).href, { redirect: 'manual', ...init })
    return mf.dispatchFetch(new URL(input, origin), { redirect: 'manual', ...init })
  }
  /** The confirmation link in the newest message to `email`, if any. */
  const linkFor = email => {
    const mail = mails.findLast(message => message.to.some(to => to.includes(email)))
    const href = mail && `${mail.text ?? ''} ${mail.html ?? ''}`.match(/https:\/\/[^\s"<>]*\/auth\/confirm\?token=[^\s"<>]+/)?.[0]
    return href ? new URL(href.replaceAll('&amp;', '&')) : null
  }
  /** The Worker's D1, for checks that move an assignment's clock (AUTO-009), and its D1 and R2 together for the
   * installation archive `rer export` writes (BEAM-16); everything else goes through the doors. */
  const db = await mf.getD1Database('DB'), files = await mf.getR2Bucket('FILES')
  return { origin, vars, mails, edge, fetch, linkFor, close, db, files, scheduled: () => mf.getWorker().then(worker => worker.scheduled({ cron: '0 8 * * *', scheduledTime: Date.now() })) }
}
