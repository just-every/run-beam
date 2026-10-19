// Completion events are durable beside the learning record. A rule resolves
// relationships at execution time; private inbox reads recheck current access.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { controlledExecution } from './automation-execution'
import { all, commit, insist, now, one, stmt } from './core'
import type { Input } from './input'
import { notificationRule } from './notification-rules'
import { noticeVariant, renderNotice, type NoticeValues } from './notification-template'
import { requireOwner } from './actor'
import { manages } from './scope'
import { requireCourseRole } from './units'

export async function completionNotifications(env: Bindings, completion: string, manual = false, onlyRule?: string) {
  const event = await one(env, `SELECT c.id,c.learner_id,c.course_id,c.assignment_id,m.name,m.preferred_name,m.location,a.due_date,t.title FROM beam_completions c JOIN beam_members m ON m.id=c.learner_id JOIN beam_courses t ON t.id=c.course_id LEFT JOIN beam_assignments a ON a.id=c.assignment_id WHERE c.id=?`, completion)
  if (!event) return []
  const rules = await all(env, 'SELECT * FROM beam_notification_rules WHERE (? IS NULL OR id=?)', onlyRule ?? null, onlyRule ?? null)
  const results = []
  for (const rule of rules) {
    let resolution = await one(env, 'SELECT recipients_json FROM beam_notification_resolutions WHERE rule_id=? AND completion_id=?', rule.id, completion)
    if (!resolution) {
      const matches = rule.enabled === 1 && (!rule.course_id || rule.course_id === event.course_id)
        && (!rule.location || rule.location.toLowerCase() === (event.location ?? '').toLowerCase())
        && (!rule.team_id || !!await one(env, 'SELECT 1 FROM beam_team_members WHERE team_id=? AND member_id=?', rule.team_id, event.learner_id))
      const candidates = matches ? await all(env, `SELECT DISTINCT m.id FROM beam_members m LEFT JOIN oa_operators o ON o.id=m.operator_id WHERE m.employment<>'terminated' AND (o.status IS NULL OR o.status<>'inactive') AND ${rule.recipient === 'learner' ? 'm.id=?1' : `m.id IN (SELECT g.member_id FROM beam_team_managers g JOIN beam_team_members t ON t.team_id=g.team_id WHERE t.member_id=?1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?2))`} AND (?2 IS NOT NULL)`, event.learner_id, now()) : []
      await env.DB.prepare('INSERT OR IGNORE INTO beam_notification_resolutions VALUES(?,?,?,?)').bind(rule.id, completion, JSON.stringify(candidates.map(person => person.id)), now()).run()
      resolution = (await one(env, 'SELECT recipients_json FROM beam_notification_resolutions WHERE rule_id=? AND completion_id=?', rule.id, completion))!
    }
    if (!rule.enabled) continue
    // A replay never adds a newly appointed manager to an earlier event's recipients.
    const recipients = await all(env, 'SELECT id,language FROM beam_members WHERE id IN (SELECT value FROM json_each(?))', resolution.recipients_json)
    const values: NoticeValues = { learner_name: event.preferred_name || event.name, course_name: event.title, due_date: event.due_date ?? 'No assignment due date', assignment_link: event.assignment_id ? `/app/learn/${event.assignment_id}` : `/app/records/${event.learner_id}` }
    for (const recipient of recipients) {
      const language = (recipient.language ?? 'default').toLowerCase(), variant = noticeVariant(JSON.parse(rule.variants_json), language)
      const subject = renderNotice(variant.subject, values), body = renderNotice(variant.body, values)
      const key = `completion:${completion}:${recipient.id}`
      const outcome = await controlledExecution(env, { kind: 'notification', rule: rule.id, event: key, learner: event.learner_id, authority: rule.created_by, unit: null, input: { completion, course: event.course_id, recipient: recipient.id, ruleVersion: rule.version, language, subject, body }, manual }, async artifact => {
        // Resolve again after reservation so a removed relationship cannot receive the result.
        const active = await one(env, `SELECT 1 FROM beam_members m LEFT JOIN oa_operators o ON o.id=m.operator_id WHERE m.id=? AND m.employment<>'terminated' AND (o.status IS NULL OR o.status<>'inactive')`, recipient.id)
        const manager = rule.recipient !== 'manager' || await one(env, 'SELECT 1 FROM beam_team_managers g JOIN beam_team_members t ON t.team_id=g.team_id WHERE g.member_id=? AND t.member_id=? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)', recipient.id, event.learner_id, now())
        insist(active && manager, 'recipient_access_changed', 409)
        const current = await notificationRule(env, rule.id)
        insist(current.enabled === 1, 'notification_paused', 409)
        insist(current.version === rule.version, 'notification_changed', 409)
        await commit(env, [stmt(env, 'INSERT OR IGNORE INTO beam_notification_messages VALUES(?,?,?,?,?,?,?,?,?,?,0,?)', artifact, rule.id, rule.version, `completion:${completion}`, event.learner_id, recipient.id, event.course_id, subject, body, language, now())], { actor: rule.created_by, action: 'notification.in_app', subject: artifact, detail: { rule: rule.id, ruleVersion: rule.version, event: completion, recipient: recipient.id, channel: 'in_app' } })
        return 'recorded_in_app'
      })
      results.push({ rule: rule.id, recipient: recipient.id, outcome })
    }
  }
  return results
}

export async function replayNotifications(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const rule = await notificationRule(env, input.text('rule'))
  insist(rule.enabled, 'notification_paused', 409)
  const results = []
  for (const event of await all(env, 'SELECT completion_id FROM beam_notification_events WHERE at>=? ORDER BY at,completion_id', rule.created_at)) results.push(...await completionNotifications(env, event.completion_id, true, rule.id))
  return { results }
}

export async function notificationInbox(env: Bindings, actor: Actor) {
  const messages = await all(env, `SELECT n.*,c.title AS courseTitle,a.id AS assignmentId FROM beam_notification_messages n LEFT JOIN beam_courses c ON c.id=n.course_id LEFT JOIN beam_completions e ON 'completion:'||e.id=n.event_key LEFT JOIN beam_assignments a ON a.id=e.assignment_id WHERE recipient_id=? ORDER BY n.at DESC,n.rowid DESC`, actor.id)
  const visible = []
  for (const message of messages) {
    if (message.test || message.learner_id === actor.id || actor.owner) { visible.push(message); continue }
    if (!manages(actor, message.learner_id)) continue
    try { await requireCourseRole(env, actor, message.course_id, 'manager'); visible.push(message) } catch { /* Current authority no longer exposes this result. */ }
  }
  return visible
}
