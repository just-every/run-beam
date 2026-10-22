// CONNECT-015: immutable subscriptions, transactional events and bounded explicit redelivery.
// No learner names, email, answers, scores, evidence, attachments or private practice leave this door.
import type { Bindings } from '../auth.server'
import { dashboardAuthority, type Actor } from './actor'
import { controlledExecution } from './automation-execution'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { openSecret, randomSecret, sealSecret, signWebhook } from './integration-secrets'
import { integrationHuman, integrationCourse, integrationTeam } from './integration-authority'
import { recoverInterruptedWebhooks, claimWebhookSend, finishWebhookSend, confirmInterruptedWebhookReplay } from './webhook-recovery'
export const WEBHOOK_EVENTS = ['enrollment', 'progress', 'completion', 'renewal', 'publication']
const DELAYS = [60_000, 300_000, 1_800_000]

/** The server operator admits trusted receiver hostnames. Owners cannot widen egress with a subscription.
 * Literal addresses, internal names, alternate ports, credentials, query strings and redirects never qualify. */
function endpoint(env: Bindings, value: string) {
  let url: URL
  try { url = new URL(value) } catch { insist(false, 'unsafe_webhook_endpoint') }
  const host = url.hostname.toLowerCase()
  insist(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/.test(host) &&
    !/(?:^|\.)(?:localhost|local|internal|home|lan|invalid)$/.test(host) && host !== new URL(env.AUTH_ORIGIN).hostname,
    'unsafe_webhook_endpoint')
  const allowed = (env.BEAM_WEBHOOK_HOSTS ?? '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean)
  insist(allowed.includes(host), 'webhook_host_not_admitted', 403)
  return url.href
}
async function allowedScope(env: Bindings, actor: Actor, sub: Row) {
  for (const course of JSON.parse(sub.courses_json)) if (!await integrationCourse(env, actor, course)) return false
  for (const team of JSON.parse(sub.teams_json)) if (!await integrationTeam(env, actor, team)) return false
  return true
}
async function requireSubscription(env: Bindings, actor: Actor, id: string) {
  integrationHuman(actor)
  const sub = await one(env, 'SELECT * FROM beam_webhook_subscriptions WHERE id=?', id)
  insist(sub && await allowedScope(env, actor, sub), 'webhook_outside_your_scope', 403)
  return sub
}

export async function subscribeWebhook(env: Bindings, actor: Actor, input: Input) {
  integrationHuman(actor)
  insist(input.flag('consent'), 'webhook_consent_required')
  const target = endpoint(env, input.text('endpoint', { max: 2048 })), name = input.text('name', { max: 80 })
  const teams = [...new Set(input.list('teams'))], courses = [...new Set(input.list('courses'))], events = [...new Set(input.list('events'))]
  insist(events.length > 0 && events.every(event => WEBHOOK_EVENTS.includes(event)), 'invalid_webhook_events')
  insist(courses.length > 0 && courses.length <= 100 && teams.length <= 100 && (!events.some(event => event !== 'publication') || teams.length > 0), 'webhook_scope_required')
  for (const course of courses) insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id=?', course), 'course_not_found', 404)
  for (const team of teams) insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id=?', team), 'team_not_found', 404)
  insist(await allowedScope(env, actor, { courses_json: JSON.stringify(courses), teams_json: JSON.stringify(teams) }), 'webhook_outside_your_scope', 403)
  const id = newId(), key = randomSecret(), at = now()
  await commit(env, [stmt(env, 'INSERT INTO beam_webhook_subscriptions(id,name,endpoint,teams_json,courses_json,events_json,key_cipher,created_by,created_at,consent_at) VALUES(?,?,?,?,?,?,?,?,?,?)', id, name, target, JSON.stringify(teams), JSON.stringify(courses), JSON.stringify(events), await sealSecret(env, key, `webhook:${id}`), actor.id, at, at)],
    { actor, action: 'webhook.subscribe', subject: id, detail: { name, endpoint: target, teams, courses, events, consentAt: at } })
  return { id, key, keyVersion: 1, state: 'disabled' }
}
export async function rotateWebhook(env: Bindings, actor: Actor, input: Input) {
  integrationHuman(actor)
  const sub = await requireSubscription(env, actor, input.text('subscription'))
  insist(!sub.revoked_at, 'webhook_not_found', 404)
  const key = randomSecret()
  await commit(env, [stmt(env, 'UPDATE beam_webhook_subscriptions SET key_cipher=?,key_version=key_version+1,enabled=0 WHERE id=?', await sealSecret(env, key, `webhook:${sub.id}`), sub.id)], { actor, action: 'webhook.rotate', subject: sub.id })
  return { id: sub.id, key, keyVersion: sub.key_version + 1, state: 'disabled' }
}
export async function setWebhookState(env: Bindings, actor: Actor, input: Input) {
  integrationHuman(actor)
  const sub = await requireSubscription(env, actor, input.text('subscription'))
  insist(!sub.revoked_at, 'webhook_not_found', 404)
  const enable = input.flag('enabled'), revoke = input.flag('revoke')
  if (enable && !revoke) { insist(input.flag('consent'), 'webhook_consent_required'); endpoint(env, sub.endpoint); await openSecret(env, sub.key_cipher, `webhook:${sub.id}`) }
  await commit(env, [stmt(env, 'UPDATE beam_webhook_subscriptions SET enabled=?,revoked_at=?,created_by=?,consent_at=? WHERE id=? AND revoked_at IS NULL', enable && !revoke ? 1 : 0, revoke ? now() : null, actor.id, now(), sub.id)], { actor, action: revoke ? 'webhook.revoke' : 'webhook.state', subject: sub.id, detail: { enabled: enable && !revoke, consent: enable && !revoke } })
  const current = (await one(env, 'SELECT revoked_at FROM beam_webhook_subscriptions WHERE id=?', sub.id))!
  insist(revoke || !current.revoked_at, 'webhook_not_found', 404)
  return { id: sub.id, enabled: enable && !revoke, revoked: revoke }
}
export async function webhookView(env: Bindings, actor: Actor) {
  integrationHuman(actor)
  await recoverInterruptedWebhooks(env)
  const allowed: Row[] = []
  for (const sub of await all(env, 'SELECT * FROM beam_webhook_subscriptions ORDER BY created_at,id')) if (await allowedScope(env, actor, sub)) allowed.push(sub)
  const subscriptions = allowed.map(({ key_cipher, ...row }) => ({ ...row, keyVersion: row.key_version, createdBy: row.created_by, createdAt: row.created_at, consentAt: row.consent_at, revokedAt: row.revoked_at, teams: JSON.parse(row.teams_json), courses: JSON.parse(row.courses_json), events: JSON.parse(row.events_json), teams_json: undefined, courses_json: undefined, events_json: undefined }))
  const deliveries = (await all(env, 'SELECT d.*,e.type,e.data_json AS data FROM beam_webhook_deliveries d JOIN beam_webhook_events e ON e.id=d.event_id ORDER BY d.rowid DESC LIMIT 200')).filter(row => allowed.some(sub => sub.id === row.subscription_id))
  const attempts = (await all(env, 'SELECT * FROM beam_webhook_attempts ORDER BY rowid DESC LIMIT 200')).filter(row => deliveries.some(delivery => delivery.id === row.delivery_id))
  return { subscriptions, deliveries, attempts, externalSpendCents: 0 }
}
async function liveScope(env: Bindings, sub: Row, event: Row) {
  const authority = await dashboardAuthority(env, sub.created_by)
  if (!authority || !await allowedScope(env, authority, sub)) return false
  if (!sub.enabled || sub.revoked_at || !JSON.parse(sub.courses_json).includes(event.course_id) || !JSON.parse(sub.events_json).includes(event.type)) return false
  if (!event.learner_id) return true
  return Boolean(await one(env, `SELECT 1 FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id JOIN beam_team_members t ON t.member_id=m.id WHERE m.id=? AND m.employment='active' AND o.status='active' AND t.team_id IN (SELECT value FROM json_each(?))`, event.learner_id, sub.teams_json))
}
async function deliver(env: Bindings, id: string, manual: boolean) {
  const delivery = await one(env, 'SELECT * FROM beam_webhook_deliveries WHERE id=?', id)
  insist(delivery, 'webhook_delivery_not_found', 404)
  if (delivery.state === 'held' && delivery.outcome === 'outcome_unknown') return 'outcome_unknown'
  if (['delivered', 'suppressed', 'sending', 'dead_letter'].includes(delivery.state) || delivery.due_at > now()) return delivery.state
  const sub = (await one(env, 'SELECT * FROM beam_webhook_subscriptions WHERE id=?', delivery.subscription_id))!, event = (await one(env, 'SELECT * FROM beam_webhook_events WHERE id=?', delivery.event_id))!
  if (!await liveScope(env, sub, event)) {
    await commit(env, [stmt(env, "UPDATE beam_webhook_deliveries SET state='suppressed',outcome='subscription_or_scope_ended' WHERE id=? AND state IN ('pending','retry','held')", id)], { actor: sub.created_by, action: 'webhook.suppress', subject: id })
    return 'suppressed'
  }
  // Each provider attempt has its own retained AUTO-008 reservation. Holds do not consume a delivery attempt.
  const outcome = await controlledExecution(env, { kind: 'webhook', rule: sub.id, event: `${id}:${delivery.cycle}:${delivery.tries}`, learner: event.learner_id ?? sub.created_by, authority: sub.created_by, unit: null, input: { delivery: id, event: event.id, keyVersion: sub.key_version, externalSpendCents: 0 }, manual, authorized: async () => { const authority = await dashboardAuthority(env, sub.created_by); return Boolean(authority && await allowedScope(env, authority, sub)) } }, async () => {
    const target = endpoint(env, sub.endpoint), key = await openSecret(env, sub.key_cipher, `webhook:${sub.id}`)
    const current = (await one(env, 'SELECT * FROM beam_webhook_subscriptions WHERE id=?', sub.id))!
    insist(await liveScope(env, current, event) && current.key_version === sub.key_version, 'webhook_authority_changed', 409)
    const sendToken = await claimWebhookSend(env, delivery, sub.key_version)
    const body = JSON.stringify({ specversion: '1.0', schema: 'beam.lifecycle.v1', id: event.id, type: event.type, time: new Date(event.at).toISOString(), data: JSON.parse(event.data_json) })
    const timestamp = String(Math.floor(now() / 1000)), signature = await signWebhook(key, `${timestamp}.${body}`)
    let status: number | null = null, result = 'network_failed'
    try {
      // A receiver's response body is never retained, followed or rendered; redirects are failures.
      const response = await fetch(target, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'content-type': 'application/json', 'x-beam-event-id': event.id, 'x-beam-key-version': String(sub.key_version), 'x-beam-signature': `t=${timestamp},v1=${signature}` }, body })
      status = response.status; result = response.ok ? 'accepted' : `http_${status}`
      await response.body?.cancel()
    } catch { /* Network detail can contain credentials or provider response data; keep only the fixed code. */ }
    const state = await finishWebhookSend(env, delivery, sendToken, sub.created_by, sub.key_version, status, result, DELAYS[delivery.tries])
    insist(state !== 'outcome_unknown', 'webhook_outcome_unknown', 409)
    insist(state === 'delivered', 'webhook_provider_denied', 502)
    return 'accepted'
  })
  if (outcome === 'already_ran' || outcome === 'outcome_unknown') return outcome
  await env.DB.prepare("UPDATE beam_webhook_deliveries SET state='held',outcome=? WHERE id=? AND (state IN ('pending','held') OR (state='retry' AND ?<>'failed'))").bind(outcome, id, outcome).run()
  return outcome
}
/** Cron tries only new events once. Failures/holds never retry without an explicit owner action. */
export async function runWebhooks(env: Bindings, actor?: Actor) {
  if (actor) integrationHuman(actor)
  await recoverInterruptedWebhooks(env)
  const work = await all(env, "SELECT id FROM beam_webhook_deliveries WHERE state='pending' ORDER BY rowid LIMIT 50")
  const results = []
  for (const row of work) {
    const sub = actor && await one(env, 'SELECT s.* FROM beam_webhook_subscriptions s JOIN beam_webhook_deliveries d ON d.subscription_id=s.id WHERE d.id=?', row.id)
    if (!actor || sub && await allowedScope(env, actor, sub)) results.push({ id: row.id, outcome: await deliver(env, row.id, false) })
  }
  return results
}
export async function replayWebhook(env: Bindings, actor: Actor, input: Input) {
  integrationHuman(actor)
  const id = input.text('delivery')
  const subject = await one(env, 'SELECT subscription_id FROM beam_webhook_deliveries WHERE id=?', id)
  insist(subject, 'webhook_delivery_not_found', 404)
  await requireSubscription(env, actor, subject.subscription_id)
  await recoverInterruptedWebhooks(env, id)
  const delivery = (await one(env, 'SELECT * FROM beam_webhook_deliveries WHERE id=?', id))!
  await confirmInterruptedWebhookReplay(env, actor, delivery, input.flag('confirm'))
  if (delivery.state === 'dead_letter') {
    insist(input.flag('confirm'), 'webhook_replay_confirmation_required', 409)
    await commit(env, [stmt(env, "UPDATE beam_webhook_deliveries SET state='retry',tries=0,cycle=cycle+1,due_at=? WHERE id=? AND state='dead_letter'", now(), id)], { actor, action: 'webhook.replay', subject: id })
  }
  return { id, outcome: await deliver(env, id, true) }
}
