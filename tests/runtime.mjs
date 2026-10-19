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

export async function emittedWorker({ bindings = {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'beam-worker-'))
  const server = join(root, 'dist/server')
  const config = JSON.parse(await readFile(join(server, 'wrangler.json'), 'utf8'))
  const port = await freePort()
  const origin = `https://127.0.0.1:${port}`
  const secret = () => randomBytes(32).toString('base64url')
  const vars = { AUTH_ORIGIN: origin, OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: secret(), SETUP_TOKEN: secret(), MAIL_PROVIDER: 'resend', MAIL_FROM: 'Beam <auth@example.test>', MAIL_API_KEY: secret(), ...bindings }
  const mails = []
  const options = convertV4MiniflareOptions({
    host: '127.0.0.1', port, https: true, modulesRoot: server,
    modules: [config.main, ...(await readdir(join(server, 'assets'))).filter(name => name.endsWith('.js')).map(name => `assets/${name}`)].map(name => ({ type: 'ESModule', path: join(server, name) })),
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    assets: { directory: join(root, 'dist/client'), routerConfig: { has_user_worker: true } },
    d1Databases: { DB: 'beam-tests' }, r2Buckets: { FILES: 'beam-tests-files' },
    bindings: vars,
    outboundService: async request => {
      if (request.url !== 'https://api.resend.com/emails') throw new Error(`Unexpected test network destination ${new URL(request.url).origin}`)
      mails.push(await request.json())
      return Response.json({ id: `test-receipt-${mails.length}` })
    },
  })
  const mf = new Miniflare({ ...options, resourcePersistencePath: join(directory, 'state') })
  const close = async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }) }
  try {
    await mf.ready
    const db = await mf.getD1Database('DB')
    const migrations = join(root, 'migrations/core')
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
  return { origin, vars, mails, fetch, linkFor, close, db, files, scheduled: () => mf.getWorker().then(worker => worker.scheduled({ cron: '0 8 * * *', scheduledTime: Date.now() })) }
}
