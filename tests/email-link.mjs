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

  // OPS-007 partial qualification: provider refusal, safe recovery and isolated session revocation.
  const attemptsBefore = worker.edge.attempts.length, acceptedBefore = worker.mails.length
  worker.edge.refuse = true
  const refused = await post('/auth/magic-link', { email: vars.OWNER_EMAIL })
  assert.equal(refused.status, 503, 'OPS-007: provider refusal is unavailable')
  const errorText = await refused.text()
  let error
  try { error = JSON.parse(errorText) } catch { assert.fail('OPS-007: refusal returns structured JSON') }
  assert.ok(error?.error === 'mail_unavailable', 'OPS-007: refusal identifies mail_unavailable')
  assert.equal(worker.edge.attempts.length - attemptsBefore, 1, 'OPS-007: exactly one provider attempt, without automatic retry')
  assert.equal(worker.mails.length - acceptedBefore, 0, 'OPS-007: refused mail is never accepted')
  const secrets = [vars.SESSION_SECRET, vars.SETUP_TOKEN, vars.MAIL_API_KEY]
  assert.ok(secrets.every(value => !errorText.includes(value)), 'OPS-007: error JSON keeps installation secrets private')

  const rejectedMail = worker.edge.attempts.at(-1)
  const rejectedHref = `${rejectedMail.text ?? ''} ${rejectedMail.html ?? ''}`.match(/https:\/\/[^\s"<>]*\/auth\/confirm\?token=[^\s"<>]+/)?.[0]
  assert.ok(!!rejectedHref, 'OPS-007: the rejected provider attempt contains the confirmation link')
  const rejectedLink = new URL(rejectedHref.replaceAll('&amp;', '&'))
  const rejectedConfirmation = await post('/auth/confirm', { token: rejectedLink.searchParams.get('token') })
  assert.equal(rejectedConfirmation.status, 400, 'OPS-007: the rejected mail link cannot confirm')
  const rejectedCookie = rejectedConfirmation.headers.getSetCookie().map(line => line.split(';')[0]).join('; ')
  assert.ok(!rejectedCookie, 'OPS-007: rejected confirmation creates no session cookie')
  assert.equal((await worker.fetch('/auth/session', { headers: { cookie: rejectedCookie } })).status, 401, 'OPS-007: rejected confirmation grants no session')

  const errorPage = await worker.fetch('/signin?notice=mail_unavailable')
  assert.equal(errorPage.status, 200, 'OPS-007: public sign-in recovery page is available')
  const errorHtml = await errorPage.text()
  const alert = errorHtml.match(/<([a-z][\w:-]*)\b([^>]*\brole=["']alert["'][^>]*)>([\s\S]*?)<\/\1\s*>/i)
  assert.ok(!!alert && !/\bhidden(?:\s|=|$)|\baria-hidden=["']true["']/i.test(alert[2]) && alert[3].replace(/<[^>]*>/g, '').trim().length > 0, 'OPS-007: the recovery page exposes a nonempty accessible alert')
  assert.ok(secrets.every(value => !errorHtml.includes(value)), 'OPS-007: the recovery page keeps installation secrets private')

  worker.edge.refuse = false
  assert.equal((await post('/auth/magic-link', { email: vars.OWNER_EMAIL })).status, 202, 'OPS-007: an explicit fresh request succeeds after provider correction')
  assert.equal(worker.edge.attempts.length - attemptsBefore, 2, 'OPS-007: recovery makes one fresh provider attempt')
  assert.equal(worker.mails.length - acceptedBefore, 1, 'OPS-007: the fresh message is accepted')
  const freshLink = worker.linkFor(vars.OWNER_EMAIL)
  assert.ok(!!freshLink && freshLink.href !== rejectedLink.href && freshLink.href !== link.href, 'OPS-007: recovery issues a fresh link')
  const freshConfirmation = await post('/auth/confirm', { token: freshLink.searchParams.get('token') })
  assert.equal(freshConfirmation.status, 303, 'OPS-007: the fresh link confirms')
  const freshCookie = freshConfirmation.headers.getSetCookie().map(line => line.split(';')[0]).join('; ')
  assert.ok(!!freshCookie && freshCookie !== cookie, 'OPS-007: fresh confirmation creates a separate session')
  assert.equal((await worker.fetch('/auth/session', { headers: { cookie: freshCookie } })).status, 200, 'OPS-007: the fresh session is live')
  assert.equal((await post('/auth/signout', {}, cookie)).status, 204, 'OPS-007: the old session signs out')
  assert.equal((await worker.fetch('/auth/session', { headers: { cookie } })).status, 401, 'OPS-007: replaying the old cookie is refused')
  assert.equal((await worker.fetch('/auth/session', { headers: { cookie: freshCookie } })).status, 200, 'OPS-007: signing out the old session leaves the fresh session live')
  console.log('Email-link sign-in passed against the emitted Worker: claim, mailed link, confirmation, session; OPS-007 partial qualification: mail refusal, safe fresh-link recovery, isolated session revocation')
} finally {
  await worker.close()
}
