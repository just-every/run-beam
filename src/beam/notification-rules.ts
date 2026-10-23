// NOTICE-005's account-free slice: completion notices in Beam. Configuration and
// tests belong to scoped administrators; no text here is claimed to have been emailed.
import type { Bindings } from '../auth.server'
import { type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { noticeVariant, renderNotice, validateNoticeVariants, type NoticeValues } from './notification-template'

export const notificationAdministrator = (actor: Actor) => !actor.agent && !actor.viewAs && (actor.owner || actor.adminUnits.length > 0 || !!actor.grants.notifications)

/** Delegates need a bounded team or location; ordinary management alone cannot edit rules. */
export async function notificationAccess(env: Bindings, actor: Actor, rule: { team_id?: string | null; location?: string | null }) {
  if (!notificationAdministrator(actor)) return false
  if (actor.owner) return true
  if (rule.team_id && (actor.grants.notifications?.teams.includes(rule.team_id) || await one(env, 'SELECT 1 FROM beam_teams WHERE id=? AND unit_id IN (SELECT value FROM json_each(?))', rule.team_id, JSON.stringify(actor.adminUnits)))) return true
  return !!rule.location && !!actor.grants.notifications?.locations.some(location => location.toLowerCase() === rule.location!.toLowerCase())
}

export async function requireNotificationAccess(env: Bindings, actor: Actor, rule: { team_id?: string | null; location?: string | null }) {
  insist(await notificationAccess(env, actor, rule), 'notification_outside_scope', 403)
}

export function notificationLearnerScope(actor: Actor, learner: string) {
  return actor.owner || (actor.adminUnits.length > 0 && !!actor.learners?.includes(learner)) || !!actor.grants.notifications?.learners.includes(learner)
}

export async function notificationRule(env: Bindings, id: string) {
  const rule = await one(env, 'SELECT * FROM beam_notification_rules WHERE id=?', id)
  insist(rule, 'notification_not_found', 404)
  return rule
}

export async function saveNotification(env: Bindings, actor: Actor, input: Input) {
  insist(notificationAdministrator(actor), 'forbidden', 403)
  const id = input.text('rule', { optional: true }) || newId(), existing = input.has('rule') ? await notificationRule(env, id) : null
  if (existing) await requireNotificationAccess(env, actor, existing)
  if (existing) insist(existing.version === input.integer('version'), 'notification_changed', 409)
  const name = input.text('name', { max: 120 }), recipient = input.text('recipient')
  insist(['learner','manager','assessor','admin'].includes(recipient), 'invalid_recipient')
  const event = input.text('event', { optional: true }) || 'completion'
  insist(['completion','evidence_pending'].includes(event), 'invalid_notification_event')
  insist(event !== 'evidence_pending' || ['learner','assessor','manager'].includes(recipient), 'invalid_recipient')
  const course = input.text('course', { optional: true }) || null, team = input.text('team', { optional: true }) || null, location = input.text('location', { optional: true, max: 160 }) || null
  if (course) insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id=?', course), 'course_not_found', 404)
  if (team) insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id=?', team), 'team_not_found', 404)
  await requireNotificationAccess(env, actor, { team_id: team, location })
  const path = input.text('path', { optional: true }) || null
  if (path) insist(await one(env, 'SELECT 1 FROM beam_paths WHERE id=?', path), 'path_not_found', 404)
  let raw = input.has('variants') ? input.json('variants') : undefined
  if (!raw) {
    const variants: Record<string, unknown> = { ...(existing ? JSON.parse(existing.variants_json) : {}), default: { subject: input.text('subject', { max: 200 }), body: input.text('body', { max: 5000 }) } }
    if (input.has('variantSubject') || input.has('variantBody')) variants[input.text('variantLanguage', { max: 32 }).toLowerCase()] = { subject: input.text('variantSubject', { max: 200 }), body: input.text('variantBody', { max: 5000 }) }
    raw = variants
  }
  const variants = validateNoticeVariants(raw), version = (existing?.version ?? 0) + 1, at = now()
  const settings = { name, event, recipient, course, path, team, location, variants }
  await commit(env, [
    stmt(env, `INSERT INTO beam_notification_rules(id,name,version,recipient,course_id,team_id,location,variants_json,enabled,created_by,created_at,updated_at,path_id,event_kind) VALUES(?,?,?,?,?,?,?,?,0,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,recipient=excluded.recipient,course_id=excluded.course_id,team_id=excluded.team_id,location=excluded.location,path_id=excluded.path_id,event_kind=excluded.event_kind,variants_json=excluded.variants_json,enabled=0,updated_at=excluded.updated_at`, id, name, version, recipient, course, team, location, JSON.stringify(variants), actor.id, at, at, path, event),
    stmt(env, 'INSERT INTO beam_notification_rule_versions VALUES(?,?,?,?)', id, version, JSON.stringify(settings), at),
  ], { actor, action: 'notification.save', subject: id, detail: { version, ...settings } })
  return { id, version }
}

export async function testNotification(env: Bindings, actor: Actor, input: Input) {
  insist(notificationAdministrator(actor), 'forbidden', 403)
  const rule = await notificationRule(env, input.text('rule'))
  await requireNotificationAccess(env, actor, rule)
  const language = (await one(env, 'SELECT language FROM beam_members WHERE id=?', actor.id))?.language ?? 'default'
  const course = await one(env, 'SELECT id,title FROM beam_courses WHERE (? IS NULL OR id=?) ORDER BY created_at,id LIMIT 1', rule.course_id, rule.course_id)
  insist(course, 'create_course_before_notification_test', 409)
  const own = await one(env, "SELECT id,due_date FROM beam_assignments WHERE learner_id=? AND course_id=? AND status='open' ORDER BY assigned_at DESC LIMIT 1", actor.id, course.id)
  const values: NoticeValues = { learner_name: actor.name, course_name: course.title, due_date: own?.due_date ?? 'No assignment due date', assignment_link: own ? `/app/learn/${own.id}` : '/app/learning' }
  const variant = noticeVariant(JSON.parse(rule.variants_json), language)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_notification_messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, rule.id, rule.version, `test:${id}`, actor.id, actor.id, null, renderNotice(variant.subject, values), renderNotice(variant.body, values), language, 1, now())], { actor, action: 'notification.test', subject: rule.id, detail: { version: rule.version, recipient: actor.id, channel: 'in_app' } })
  return { id, channel: 'in_app', test: true }
}

export async function setNotificationEnabled(env: Bindings, actor: Actor, input: Input) {
  insist(notificationAdministrator(actor), 'forbidden', 403)
  const rule = await notificationRule(env, input.text('rule')), enabled = input.flag('enabled')
  await requireNotificationAccess(env, actor, rule)
  insist(!enabled || await one(env, 'SELECT 1 FROM beam_notification_messages WHERE rule_id=? AND rule_version=? AND test=1 AND recipient_id=?', rule.id, rule.version, actor.id), 'test_notification_first', 409)
  await commit(env, [stmt(env, 'UPDATE beam_notification_rules SET enabled=?,enabled_by=? WHERE id=?', enabled ? 1 : 0, enabled ? actor.id : null, rule.id)], { actor, action: 'notification.state', subject: rule.id, detail: { version: rule.version, enabled } })
  return { id: rule.id, enabled }
}

export async function notificationRulesView(env: Bindings, actor: Actor) {
  insist(notificationAdministrator(actor), 'forbidden', 403)
  const [rules, messages] = await Promise.all([all(env, 'SELECT * FROM beam_notification_rules ORDER BY created_at DESC,rowid DESC'), all(env, 'SELECT n.id,n.rule_id AS rule,n.rule_version AS version,n.event_key AS event,n.recipient_id AS recipient,n.learner_id AS learner,m.name AS recipientName,n.subject,n.language,n.test,n.at FROM beam_notification_messages n JOIN beam_members m ON m.id=n.recipient_id ORDER BY n.at DESC,n.rowid DESC LIMIT 100')])
  const visible: Row[] = []
  for (const rule of rules) if (await notificationAccess(env, actor, rule)) visible.push(rule)
  return { rules: visible.map(rule => ({ ...rule, variants: JSON.parse(rule.variants_json) }) as Row), messages: messages.filter(message => visible.some(rule => rule.id === message.rule) && (message.test ? actor.owner || message.recipient === actor.id : notificationLearnerScope(actor, message.learner))) }
}
