// Completion events are durable beside the learning record. A rule resolves
// relationships at execution time; private inbox reads recheck current access.
import type { Bindings } from '../auth.server'
import { dashboardAuthority, type Actor } from './actor'
import { controlledExecution } from './automation-execution'
import { all, commit, insist, now, one, stmt } from './core'
import type { Input } from './input'
import { notificationRule, notificationAccess, requireNotificationAccess, notificationLearnerScope } from './notification-rules'
import { noticeVariant, renderNotice, type NoticeValues } from './notification-template'

/** Recipient relationships grant no new result access; each uses an existing live reader. */
async function notificationRecipients(env: Bindings, relationship: string, learner: string, course: string, assignment: string | null) {
  const relation = relationship === 'learner' ? 'm.id=?1'
    : relationship === 'manager' ? `m.id IN (SELECT g.member_id FROM beam_team_managers g JOIN beam_team_members t ON t.team_id=g.team_id WHERE t.member_id=?1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?2))`
    : relationship === 'assessor' ? `EXISTS(SELECT 1 FROM beam_assignments a JOIN beam_assessment_revisions s ON s.course_revision_id=a.course_revision_id JOIN beam_member_roles role ON role.member_id=m.id AND role.role='assessor' WHERE a.id=?4 AND s.assessor_id=m.id)`
    : relationship === 'admin' ? `(o.role='owner' OR EXISTS(SELECT 1 FROM beam_admin_grants g JOIN beam_courses c ON c.unit_id=g.unit_id JOIN beam_teams t ON t.unit_id=g.unit_id JOIN beam_team_members tm ON tm.team_id=t.id WHERE g.member_id=m.id AND c.id=?3 AND tm.member_id=?1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?2)))`
    : '0'
  return await all(env, `SELECT DISTINCT m.id FROM beam_members m LEFT JOIN oa_operators o ON o.id=m.operator_id
    WHERE m.employment<>'terminated' AND (o.status IS NULL OR o.status='active') AND ${relation}
      AND (?1 IS NOT NULL) AND (?2 IS NOT NULL) AND (?3 IS NOT NULL) AND (?4 IS NULL OR ?4 IS NOT NULL)`, learner, now(), course, assignment)
}

export async function completionNotifications(env: Bindings, completion: string, manual = false, onlyRule?: string) {
  const event = await one(env, `SELECT c.id,c.learner_id,c.course_id,c.assignment_id,m.name,m.preferred_name,m.location,a.due_date,a.path_revision_id,t.title FROM beam_completions c JOIN beam_members m ON m.id=c.learner_id JOIN beam_courses t ON t.id=c.course_id LEFT JOIN beam_assignments a ON a.id=c.assignment_id WHERE c.id=?`, completion)
  if (!event) return []
  const rules = await all(env, "SELECT * FROM beam_notification_rules WHERE event_kind='completion' AND (? IS NULL OR id=?)", onlyRule ?? null, onlyRule ?? null)
  const results = []
  for (const rule of rules) {
    let resolution = await one(env, 'SELECT recipients_json FROM beam_notification_resolutions WHERE rule_id=? AND completion_id=?', rule.id, completion)
    if (!resolution) {
      const pathMatches = !rule.path_id || !!await one(env, 'SELECT 1 FROM beam_path_revisions WHERE id=? AND path_id=?', event.path_revision_id, rule.path_id)
      const matches = pathMatches && rule.enabled === 1 && (!rule.course_id || rule.course_id === event.course_id)
        && (!rule.location || rule.location.toLowerCase() === (event.location ?? '').toLowerCase())
        && (!rule.team_id || !!await one(env, 'SELECT 1 FROM beam_team_members WHERE team_id=? AND member_id=?', rule.team_id, event.learner_id))
      const candidates = matches ? await notificationRecipients(env, rule.recipient, event.learner_id, event.course_id, event.assignment_id) : []
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
      const outcome = await controlledExecution(env, { kind: 'notification', rule: rule.id, event: key, learner: event.learner_id, authority: rule.enabled_by || rule.created_by, unit: null, authorized: async () => {
        const editor = await dashboardAuthority(env, rule.enabled_by || rule.created_by)
        return !!editor && await notificationAccess(env, editor, rule) && notificationLearnerScope(editor, event.learner_id)
      }, input: { completion, course: event.course_id, recipient: recipient.id, ruleVersion: rule.version, language, subject, body }, manual }, async artifact => {
        // Resolve again after reservation so a removed relationship cannot receive the result.
        insist((await notificationRecipients(env, rule.recipient, event.learner_id, event.course_id, event.assignment_id)).some(person => person.id === recipient.id), 'recipient_access_changed', 409)
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
  const rule = await notificationRule(env, input.text('rule'))
  await requireNotificationAccess(env, actor, rule)
  insist(rule.enabled, 'notification_paused', 409)
  const results = []
  if (rule.event_kind === 'evidence_pending') {
    for (const event of await all(env, "SELECT id FROM beam_attempts WHERE kind='practical' AND submitted_at>=? ORDER BY submitted_at,id", rule.created_at)) results.push(...await pendingEvidenceNotifications(env, event.id, true, rule.id))
    return { results }
  }
  for (const event of await all(env, 'SELECT completion_id FROM beam_notification_events WHERE at>=? ORDER BY at,completion_id', rule.created_at)) results.push(...await completionNotifications(env, event.completion_id, true, rule.id))
  return { results }
}

export async function notificationInbox(env: Bindings, actor: Actor) {
  const messages = await all(env, `SELECT n.*,v.settings_json AS settings,c.title AS courseTitle,a.id AS assignmentId,p.id AS attemptId,p.state AS attemptState,p.reset_id AS attemptReset,a.status AS assignmentState FROM beam_notification_messages n JOIN beam_notification_rule_versions v ON v.rule_id=n.rule_id AND v.version=n.rule_version LEFT JOIN beam_courses c ON c.id=n.course_id LEFT JOIN beam_completions e ON 'completion:'||e.id=n.event_key LEFT JOIN beam_attempts p ON 'evidence_pending:'||p.id=n.event_key LEFT JOIN beam_assignments a ON a.id=COALESCE(e.assignment_id,p.assignment_id) WHERE recipient_id=? ORDER BY n.at DESC,n.rowid DESC`, actor.id)
  const visible = []
  for (const message of messages) {
    if (message.event_key.startsWith('evidence_pending:') && (message.attemptState !== 'awaiting_review' || message.attemptReset || message.assignmentState !== 'open')) continue
    if (message.test || message.learner_id === actor.id || actor.owner) { visible.push(message); continue }
    const relationship = JSON.parse(message.settings).recipient
    if ((await notificationRecipients(env, relationship, message.learner_id, message.course_id, message.assignmentId)).some(person => person.id === actor.id)) visible.push(message)
  }
  return visible.map(({ settings, ...message }) => message)
}

/** A practical submission captures recipients once; a later decision or reset makes the notice obsolete. */
export async function pendingEvidenceNotifications(env: Bindings, attempt: string, manual = false, onlyRule?: string) {
  const event = await one(env, `SELECT t.*,a.id AS assignment_id,a.learner_id,a.course_id,a.path_revision_id,a.due_date,a.status AS assignmentState,
    m.name,m.preferred_name,m.location,c.title FROM beam_attempts t JOIN beam_assignments a ON a.id=t.assignment_id
    JOIN beam_members m ON m.id=a.learner_id JOIN beam_courses c ON c.id=a.course_id WHERE t.id=? AND t.kind='practical'`, attempt)
  if (!event || event.state !== 'awaiting_review' || event.reset_id || event.assignmentState !== 'open') return []
  const rules = await all(env, "SELECT * FROM beam_notification_rules WHERE event_kind='evidence_pending' AND (? IS NULL OR id=?)", onlyRule ?? null, onlyRule ?? null)
  const results = []
  for (const rule of rules) {
    let saved = JSON.parse((await one(env, 'SELECT notice_resolutions_json FROM beam_attempts WHERE id=?', attempt))!.notice_resolutions_json)
    if (!(rule.id in saved)) {
      const matches = rule.enabled === 1 && rule.created_at <= event.submitted_at
        && (!rule.course_id || rule.course_id === event.course_id)
        && (!rule.path_id || !!await one(env, 'SELECT 1 FROM beam_path_revisions WHERE id=? AND path_id=?', event.path_revision_id, rule.path_id))
        && (!rule.team_id || !!await one(env, 'SELECT 1 FROM beam_team_members WHERE team_id=? AND member_id=?', rule.team_id, event.learner_id))
        && (!rule.location || rule.location.toLowerCase() === (event.location ?? '').toLowerCase())
      const recipients = matches ? await notificationRecipients(env, rule.recipient, event.learner_id, event.course_id, event.assignment_id) : []
      await stmt(env, 'UPDATE beam_attempts SET notice_resolutions_json=json_insert(notice_resolutions_json,?,json(?)) WHERE id=?', `$.'${rule.id}'`.replaceAll("'", '"'), JSON.stringify(recipients.map(person => person.id)), attempt).run()
      saved = JSON.parse((await one(env, 'SELECT notice_resolutions_json FROM beam_attempts WHERE id=?', attempt))!.notice_resolutions_json)
    }
    if (!rule.enabled) continue
    const recipients = await all(env, 'SELECT id,language FROM beam_members WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(saved[rule.id]))
    const values: NoticeValues = { learner_name: event.preferred_name || event.name, course_name: event.title, due_date: event.due_date, assignment_link: `/app/attempts/${attempt}` }
    for (const recipient of recipients) {
      const language = (recipient.language ?? 'default').toLowerCase(), variant = noticeVariant(JSON.parse(rule.variants_json), language)
      const subject = renderNotice(variant.subject, values), body = renderNotice(variant.body, values)
      const outcome = await controlledExecution(env, { kind: 'notification', rule: rule.id, event: `evidence_pending:${attempt}:${recipient.id}`,
        learner: event.learner_id, authority: rule.enabled_by || rule.created_by, unit: null, manual,
        input: { attempt, course: event.course_id, recipient: recipient.id, ruleVersion: rule.version, language, subject, body },
        authorized: async () => { const editor = await dashboardAuthority(env, rule.enabled_by || rule.created_by); return !!editor && await notificationAccess(env, editor, rule) && notificationLearnerScope(editor, event.learner_id) },
      }, async artifact => {
        const current = await notificationRule(env, rule.id)
        insist(current.enabled && current.version === rule.version && current.event_kind === 'evidence_pending', 'notification_changed', 409)
        insist(await one(env, "SELECT 1 FROM beam_attempts t JOIN beam_assignments a ON a.id=t.assignment_id WHERE t.id=? AND t.state='awaiting_review' AND t.reset_id IS NULL AND a.status='open'", attempt), 'evidence_no_longer_pending', 409)
        insist((await notificationRecipients(env, rule.recipient, event.learner_id, event.course_id, event.assignment_id)).some(person => person.id === recipient.id), 'recipient_access_changed', 409)
        await commit(env, [stmt(env, 'INSERT OR IGNORE INTO beam_notification_messages VALUES(?,?,?,?,?,?,?,?,?,?,0,?)', artifact, rule.id, rule.version, `evidence_pending:${attempt}`, event.learner_id, recipient.id, event.course_id, subject, body, language, now())],
          { actor: rule.enabled_by || rule.created_by, action: 'notification.in_app', subject: artifact, detail: { rule: rule.id, ruleVersion: rule.version, event: attempt, recipient: recipient.id, channel: 'in_app' } })
        return 'recorded_in_app'
      })
      results.push({ rule: rule.id, recipient: recipient.id, outcome })
    }
  }
  return results
}
