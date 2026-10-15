import {queuedEntrypoint} from '@runeditrun/rer/queued-entry';
const queued=await queuedEntrypoint(import.meta.url,'verify:email-link');if(queued!==null)process.exit(queued);
// The foundation's one end-to-end email-link test: the emitted Worker claims
// the owner, mails a sign-in link through Resend (captured at the network
// edge), and the link signs in through confirmation. Dev identity never
// replaces this path.
import assert from 'node:assert/strict'
import { emittedWorker } from './runtime.mjs'

const worker = await emittedWorker()
const { origin, vars } = worker
const post = (path, body, cookie) => worker.fetch(path, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
try {
  assert.equal((await post('/auth/bootstrap', { token: vars.SETUP_TOKEN, displayName: 'Owner' })).status, 303, 'owner claimed')
  assert.equal((await post('/auth/magic-link', { email: vars.OWNER_EMAIL })).status, 202, 'sign-in link mailed')
  assert.equal(worker.mails.length, 1, 'one message reached the mail provider')
  assert.equal((await worker.fetch('/__dev/outbox')).status, 404, 'a hosted installation has no local mail route')
  const link = worker.linkFor(vars.OWNER_EMAIL)
  assert.ok(link, 'the message carries the sign-in link')
  assert.equal(link.origin, origin)
  assert.equal((await worker.fetch(link)).status, 200, 'confirmation page')
  const confirmed = await post('/auth/confirm', { token: link.searchParams.get('token') })
  assert.equal(confirmed.status, 303)
  const cookie = confirmed.headers.getSetCookie().map(line => line.split(';')[0]).join('; ')
  const session = await worker.fetch('/auth/session', { headers: { cookie } })
  assert.equal(session.status, 200)
  assert.equal((await session.json()).operator.email, vars.OWNER_EMAIL)
  console.log('Email-link sign-in passed against the emitted Worker: claim, mailed link, confirmation, session')
} finally {
  await worker.close()
}
