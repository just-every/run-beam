// NOTICE-004: live routing, elapsed-hour delays and durable, explicitly replayed mail.
// A directory manager field never grants learning access. Only current team grants
// route private work; the installation owner is the final fallback.
import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { requireOwner, type Actor } from './actor'
import { controlledExecution } from './automation-execution'
import { all, commit, insist, now, one, stmt, type Row } from './core'
import { EXCEPTED } from './exceptions'
import type { Input } from './input'
import { instructs } from './instructors'
import { manages } from './scope'
import { requireCourseRole } from './units'

const HOUR = 3_600_000
export const escalationPolicy = (env: Bindings) => one(env, 'SELECT * FROM beam_escalation_policy WHERE id=1')

export async function saveEscalationPolicy(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const current = await escalationPolicy(env)
  const version = input.integer('version')!
  insist(version === (current?.version ?? 0), 'policy_changed', 409)
  const reminder = input.integer('reminderHours', { max: 8760 })!, manager = input.integer('managerHours', { max: 8760 })!, fallback = input.integer('fallbackHours', { max: 8760 })!
  insist(reminder <= manager && manager <= fallback, 'invalid_escalation_delays')
  await commit(env, [stmt(env, `INSERT INTO beam_escalation_policy VALUES(1,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,enabled=excluded.enabled,reminder_hours=excluded.reminder_hours,manager_hours=excluded.manager_hours,fallback_hours=excluded.fallback_hours,updated_by=excluded.updated_by,updated_at=excluded.updated_at`, version + 1, input.flag('enabled') ? 1 : 0, reminder, manager, fallback, actor.id, now())],
    { actor, action: 'escalation.policy', subject: 'policy', detail: { version: version + 1, reminderHours: reminder, managerHours: manager, fallbackHours: fallback, enabled: input.flag('enabled') } })
  return await escalationPolicy(env)
}

async function unresolved(env: Bindings) {
  return all(env, `SELECT a.id,a.learner_id AS learner,a.course_id AS course,a.due_at AS dueAt,m.name AS learnerName,m.email,m.employment,c.title AS courseTitle,
    (SELECT COUNT(*) FROM beam_attempts t JOIN beam_assessment_revisions s ON s.id=t.assessment_revision_id WHERE t.assignment_id=a.id AND t.kind='quiz' AND t.reset_id IS NULL AND s.max_attempts IS NOT NULL AND (SELECT COUNT(*) FROM beam_attempts q WHERE q.assignment_id=a.id AND q.kind='quiz' AND q.reset_id IS NULL)>=s.max_attempts+a.extra_attempts AND NOT EXISTS(SELECT 1 FROM beam_attempts q WHERE q.assignment_id=a.id AND q.reset_id IS NULL AND q.passed=1)) AS exhausted,
    (SELECT s.assessor_id FROM beam_assessment_revisions s WHERE s.course_revision_id=a.course_revision_id AND s.practical_instructions IS NOT NULL AND s.practical_instructions<>'') AS assessor
    FROM beam_assignments a JOIN beam_members m ON m.id=a.learner_id JOIN beam_courses c ON c.id=a.course_id
    WHERE a.status='open' AND a.due_at<=? AND m.employment<>'terminated' AND NOT ${EXCEPTED('a.id')}
    AND NOT EXISTS(SELECT 1 FROM beam_escalation_resolutions r WHERE r.assignment_id=a.id) ORDER BY a.due_at,a.id`, now(), now())
}

async function targets(env: Bindings, item: Row, fallback: boolean) {
  const owner = await one(env, `SELECT m.id,m.email,'owner' AS route FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id WHERE o.role='owner' AND o.status='active' AND m.employment='active'`)
  if (fallback) return owner ? [owner] : []
  const managers = await all(env, `SELECT DISTINCT m.id,m.email,g.kind AS route FROM beam_team_managers g JOIN beam_team_members t ON t.team_id=g.team_id JOIN beam_members m ON m.id=g.member_id JOIN oa_operators o ON o.id=m.operator_id WHERE t.member_id=? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?) AND m.employment='active' AND o.status='active' ORDER BY m.id`, item.learner, now())
  const coverage = managers.filter(row => row.route === 'coverage')
  return coverage.length ? coverage : managers.length ? managers : owner ? [owner] : []
}

async function facts(env: Bindings, item: Row) {
  const failures = await all(env, `SELECT outcome,failure,updated_at AS at,json_extract(input_json,'$.route') AS route FROM beam_automation_executions WHERE kind='escalation' AND json_extract(input_json,'$.assignment')=? AND state<>'succeeded' ORDER BY updated_at`, item.id)
  let capacity = false
  if (item.assessor) {
    const assessor = await one(env, `SELECT 1 FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id JOIN beam_member_roles r ON r.member_id=m.id AND r.role='assessor' WHERE m.id=? AND m.employment='active' AND o.status='active'`, item.assessor)
    const sessions = await all(env, `SELECT s.capacity,(SELECT COUNT(*) FROM beam_session_registrations r WHERE r.session_id=s.id AND r.state='registered')+(SELECT COUNT(*) FROM beam_session_waitlist w WHERE w.session_id=s.id AND w.state='offered' AND w.offer_expires_at>?) AS seats FROM beam_sessions s WHERE s.course_id=? AND s.instructor_id=? AND s.state='scheduled' AND EXISTS(SELECT 1 FROM beam_session_meetings d WHERE d.session_id=s.id AND d.starts_at>?)`, now(), item.course, item.assessor, now())
    capacity = !assessor || !await instructs(env, item.assessor, item.course) || !sessions.some(row => row.capacity === null || row.seats < row.capacity)
  }
  return { noContactRoute: !item.email, attemptsExhausted: item.exhausted > 0, missingAssessorCapacity: capacity, onLeave: item.employment === 'leave', failures }
}

/** Existing manager authority is checked afresh for every queue read, including old deliveries. */
export async function escalationQueue(env: Bindings, actor: Actor) {
  const policy = await escalationPolicy(env)
  if (!policy?.enabled) return []
  const result = []
  for (const item of await unresolved(env)) {
    if (!manages(actor, item.learner, 'enrollment')) continue
    result.push({ assignment: item.id, learner: item.learner, learnerName: item.learnerName, course: item.course, courseTitle: item.courseTitle, dueAt: item.dueAt,
      managerAt: item.dueAt + policy.manager_hours * HOUR, fallbackAt: item.dueAt + policy.fallback_hours * HOUR,
      ...await facts(env, item), reachesNow: (await targets(env, item, now() >= item.dueAt + policy.fallback_hours * HOUR)).map(row => ({ id: row.id, route: row.route })),
      messages: await all(env, 'SELECT recipient_id AS recipient,route,status,sent_at AS at FROM beam_escalation_messages WHERE assignment_id=? ORDER BY sent_at,id', item.id) })
  }
  return result
}

export async function resolveEscalation(env: Bindings, actor: Actor, input: Input) {
  const assignment = await one(env, 'SELECT id,learner_id,course_id FROM beam_assignments WHERE id=?', input.text('assignment'))
  insist(assignment && manages(actor, assignment.learner_id, 'enrollment'), 'assignment_not_found', 404)
  if (!actor.grants.enrollment) await requireCourseRole(env, actor, assignment.course_id, 'manager')
  const reason = input.text('reason', { max: 500 })
  await commit(env, [stmt(env, 'INSERT OR IGNORE INTO beam_escalation_resolutions VALUES(?,?,?,?)', assignment.id, reason, actor.id, now())], { actor, action: 'escalation.resolve', subject: assignment.id, detail: { reason } })
  return { assignment: assignment.id, resolved: true }
}

/** Cron never retries held/failed work; the owner's explicit run does. Learner mail pauses on leave; an active exception pauses all delivery. */
export async function runEscalations(env: Bindings, manual = false) {
  const policy = await escalationPolicy(env)
  if (!policy?.enabled) return []
  const results = []
  for (const item of await unresolved(env)) {
    const elapsed = now() - item.dueAt
    if (elapsed < policy.reminder_hours * HOUR) continue
    if (elapsed < policy.manager_hours * HOUR && item.employment === 'leave') continue
    const recipients = elapsed < policy.manager_hours * HOUR ? [{ id: item.learner, email: item.email, route: 'learner' }] : await targets(env, item, elapsed >= policy.fallback_hours * HOUR)
    for (const person of recipients) {
      const outcome = await controlledExecution(env, { kind: 'escalation', rule: 'overdue-work', event: `${item.id}:${person.id}:${person.route}`, learner: item.learner, authority: policy.updated_by, unit: null, manual,
        input: { assignment: item.id, recipient: person.id, route: person.route, policyVersion: policy.version } }, async artifact => {
        const live = (await unresolved(env)).find(row => row.id === item.id), current = await escalationPolicy(env)
        insist(live && current?.enabled && current.version === policy.version, 'escalation_suppressed', 409)
        const liveElapsed = now() - live.dueAt
        const allowed = person.route === 'learner' ? live.employment === 'active' && liveElapsed < current.manager_hours * HOUR : (await targets(env, live, liveElapsed >= current.fallback_hours * HOUR)).some(row => row.id === person.id && row.route === person.route)
        insist(allowed, 'escalation_route_changed', 409)
        const sender = operatorMail(env)
        insist(sender && env.MAIL_FROM, 'mail_not_configured', 409)
        const address = (await one(env, 'SELECT email FROM beam_members WHERE id=?', person.id))?.email
        insist(address, 'no_contact_route', 409)
        insist(await one(env, "SELECT 1 FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.id=? AND o.status='active' AND m.employment<>'terminated'", person.id), 'recipient_unavailable', 409)
        const text = `Overdue learning: ${live.courseTitle}. Training is paid work time. Review the current requirement after signing in: ${env.AUTH_ORIGIN}/app/${person.route === 'learner' ? `learn/${live.id}` : 'manage'}`
        const sent = await sender.send({ deliveryId: artifact, from: env.MAIL_FROM, to: [address], subject: 'Overdue learning needs attention', text, html: `<p>${text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)}</p>`, headers: {} })
        insist(sent.status === 'accepted' || sent.status === 'development', `mail_${sent.status}`, 502)
        await commit(env, [stmt(env, 'INSERT OR IGNORE INTO beam_escalation_messages VALUES(?,?,?,?,?,?)', artifact, item.id, person.id, person.route, sent.status, now())], { actor: policy.updated_by, action: 'escalation.mail', subject: item.id, detail: { recipient: person.id, route: person.route, status: sent.status } })
        return sent.status === 'accepted' ? 'mail_accepted' : 'mail_development'
      })
      results.push({ assignment: item.id, recipient: person.id, route: person.route, outcome })
    }
  }
  return results
}

export async function runEscalationsNow(env: Bindings, actor: Actor) {
  requireOwner(actor)
  return { results: await runEscalations(env, true) }
}
