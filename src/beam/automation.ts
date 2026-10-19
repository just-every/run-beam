// AUTO-005: follow-on learning. The owner (acting as admin), or a learning administrator for courses of their units,
// saves a rule: when a learner is enrolled in (signs up for), completes or runs out of quiz attempts on a source
// course, assign a target course due a number of days later, optionally only above a quiz score or within one team.
// A rule is fixed once saved and stays a draft until a recorded dry run shows what it would do; then it can be
// enabled, paused and replayed. Each rule acts at most once per event (a run row keyed by the event), so duplicate
// events and replays never create repeated work, and a rule never touches its source assignment, attempts or completion:
// a failure branch assigns more learning and never turns the failure into a pass. Rules that would form a cycle are
// refused, and a chain of rule-made enrollments stops after MAX_DEPTH steps.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { insertAssignments } from './assignments'
import { controlledExecution } from './automation-execution'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { requireBusiness } from './people'
import { requireTeamScope } from './scope'
import { addDays, localDate } from './time'
import { requireCourseRole } from './units'

export const TRIGGERS = ['enrollment', 'completion', 'failure'] as const
type Trigger = typeof TRIGGERS[number]
export const MAX_DEPTH = 5
type Outcome = 'would_assign' | 'already_open' | 'already_ran' | 'target_unavailable'
interface Event { key: string; learner: string; assignment: string | null }

const requireAdministrator = (actor: Actor) => insist(!actor.agent && (actor.owner || actor.adminUnits.length > 0), 'forbidden', 403)

async function requireRule(env: Bindings, actor: Actor, id: string) {
  requireAdministrator(actor)
  const rule = await one(env, 'SELECT * FROM beam_automation_rules WHERE id = ?', id)
  insist(rule && (actor.owner || (rule.unit_id && actor.adminUnits.includes(rule.unit_id))), 'rule_not_found', 404)
  return rule
}

/** True when the rules (plus the new edge) let a course lead back to itself. */
async function cycles(env: Bindings, source: string, target: string, except = '') {
  const edges = await all<{ s: string; t: string }>(env, "SELECT source_course_id AS s, target_course_id AS t FROM beam_automation_rules WHERE state != 'paused' AND id != ?", except)
  const seen = new Set<string>(), queue = [target]
  while (queue.length) {
    const course = queue.shift()!
    if (course === source) return true
    if (seen.has(course)) continue
    seen.add(course)
    for (const edge of edges) if (edge.s === course) queue.push(edge.t)
  }
  return false
}

export async function saveRule(env: Bindings, actor: Actor, input: Input) {
  requireAdministrator(actor)
  const name = input.text('name', { max: 120 })
  const trigger = input.text('trigger') as Trigger
  insist(TRIGGERS.includes(trigger), 'invalid_trigger')
  const source = input.text('sourceCourse'), target = input.text('targetCourse')
  insist(source !== target, 'rule_cycle', 409)
  for (const course of [source, target]) {
    insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id = ?', course), 'course_not_found', 404)
    await requireCourseRole(env, actor, course, 'manager')
  }
  const dueDays = input.integer('dueDays', { min: 1, max: 365 })!
  const minPercent = input.integer('minPercent', { min: 0, max: 100, optional: true })
  insist(minPercent === null || trigger === 'completion', 'score_condition_needs_completion')
  const team = input.text('team', { optional: true, max: 64 }) || null
  if (team) {
    insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ?', team), 'team_not_found', 404)
    requireTeamScope(actor, team)
  }
  insist(!await cycles(env, source, target), 'rule_cycle', 409)
  // An administrator's rule acts only for people in the source course's unit.
  const unit = actor.owner ? null : (await one<{ unit_id: string }>(env, 'SELECT unit_id FROM beam_courses WHERE id = ?', source))!.unit_id
  const id = newId()
  await commit(env, [stmt(env, "INSERT INTO beam_automation_rules (id, name, trigger, source_course_id, target_course_id, due_days, min_percent, team_id, unit_id, state, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)",
    id, name, trigger, source, target, dueDays, minPercent, team, unit, actor.id, now())], { actor, action: 'automation.save', subject: id, detail: { name, trigger, source, target, dueDays, minPercent, team, unit } })
  return { id }
}

/** The events a rule matches in the records now, optionally narrowed to one assignment or completion. */
async function events(env: Bindings, rule: Row, only: { assignment?: string; completion?: string } = {}): Promise<Event[]> {
  const audience = `AND (?1 IS NULL OR learner IN (SELECT member_id FROM beam_team_members WHERE team_id = ?1))
    AND (?2 IS NULL OR learner IN (SELECT tm.member_id FROM beam_team_members tm JOIN beam_teams t ON t.id = tm.team_id WHERE t.unit_id = ?2))`
  const narrow = only.assignment ?? only.completion ?? null
  const sql = {
    enrollment: `SELECT * FROM (SELECT 'enrollment:' || a.id AS key, a.learner_id AS learner, a.id AS assignment FROM beam_assignments a
      WHERE a.course_id = ?3 AND a.status IN ('open', 'completed') AND (?4 IS NULL OR a.id = ?4) AND (?5 IS NULL OR 1)) WHERE 1 ${audience}`,
    completion: `SELECT * FROM (SELECT 'completion:' || c.id AS key, c.learner_id AS learner, c.assignment_id AS assignment FROM beam_completions c
      WHERE c.course_id = ?3 AND (?4 IS NULL OR c.id = ?4) AND (?5 IS NULL OR (SELECT MAX(t.score * 100 / t.max_score) FROM beam_attempts t
        WHERE t.assignment_id = c.assignment_id AND t.kind = 'quiz' AND t.reset_id IS NULL AND t.max_score > 0) >= ?5)) WHERE 1 ${audience}`,
    failure: `SELECT * FROM (SELECT 'failure:' || a.id AS key, a.learner_id AS learner, a.id AS assignment FROM beam_assignments a JOIN beam_assessment_revisions s ON s.course_revision_id = a.course_revision_id
      WHERE a.course_id = ?3 AND a.status = 'open' AND (?4 IS NULL OR a.id = ?4) AND s.max_attempts IS NOT NULL
        AND (SELECT COUNT(*) FROM beam_attempts t WHERE t.assignment_id = a.id AND t.kind = 'quiz' AND t.reset_id IS NULL) >= s.max_attempts + a.extra_attempts
        AND NOT EXISTS (SELECT 1 FROM beam_attempts t WHERE t.assignment_id = a.id AND t.kind = 'quiz' AND t.passed = 1 AND t.reset_id IS NULL) AND (?5 IS NULL OR 1)) WHERE 1 ${audience}`,
  }[rule.trigger as Trigger]
  return await all<Event>(env, `${sql} ORDER BY key`, rule.team_id, rule.unit_id, rule.source_course_id, narrow, rule.min_percent)
}

async function outcome(env: Bindings, rule: Row, event: Event): Promise<Outcome> {
  if (await one(env, "SELECT 1 FROM beam_automation_runs WHERE rule_id = ? AND event_key = ? AND outcome NOT IN ('target_unavailable','failed')", rule.id, event.key)) return 'already_ran'
  const target = await one(env, 'SELECT published_revision_id, retired_at FROM beam_courses WHERE id = ?', rule.target_course_id)
  if (!target?.published_revision_id || target.retired_at) return 'target_unavailable'
  if (await one(env, "SELECT 1 FROM beam_assignments WHERE learner_id = ? AND course_id = ? AND status = 'open'", event.learner, rule.target_course_id)) return 'already_open'
  return 'would_assign'
}

/** The dry run: what the rule would do for every event in the records now. It assigns nothing; it records that it ran. */
export async function previewRule(env: Bindings, actor: Actor, input: Input) {
  const rule = await requireRule(env, actor, input.text('rule'))
  const items: (Event & { outcome: Outcome })[] = []
  for (const event of await events(env, rule)) items.push({ ...event, outcome: await outcome(env, rule, event) })
  const counts = Object.fromEntries(['would_assign', 'already_open', 'already_ran', 'target_unavailable'].map(kind => [kind, items.filter(item => item.outcome === kind).length]))
  const preview = { at: now(), counts, items: items.slice(0, 200) }
  await commit(env, [stmt(env, 'UPDATE beam_automation_rules SET previewed_at = ?, preview_json = ? WHERE id = ?', preview.at, JSON.stringify(preview), rule.id)], { actor, action: 'automation.preview', subject: rule.id, detail: { counts } })
  return preview
}

export async function setRuleState(env: Bindings, actor: Actor, input: Input) {
  const rule = await requireRule(env, actor, input.text('rule'))
  const state = input.text('state')
  insist(state === 'active' || state === 'paused', 'invalid_state')
  if (state === 'active') {
    insist(rule.previewed_at, 'dry_run_required', 409)
    insist(!await cycles(env, rule.source_course_id, rule.target_course_id, rule.id), 'rule_cycle', 409)
  }
  await commit(env, [stmt(env, 'UPDATE beam_automation_rules SET state = ?, enabled_by = CASE WHEN ? = \'active\' THEN ? ELSE enabled_by END, enabled_at = CASE WHEN ? = \'active\' THEN ? ELSE enabled_at END WHERE id = ?', state, state, actor.id, state, now(), rule.id)],
    { actor, action: state === 'active' ? 'automation.enable' : 'automation.pause', subject: rule.id })
  return { id: rule.id, state }
}

/** The native enrollment keeps a reserved assignment id, so even an interrupted
 * response can be replayed without making the same event's assignment twice. */
async function run(env: Bindings, rule: Row, event: Event, depth: number, replay: boolean) {
  if (await one(env, "SELECT 1 FROM beam_automation_runs WHERE rule_id=? AND event_key=? AND outcome NOT IN ('target_unavailable','failed')", rule.id, event.key)) return 'already_ran'
  return await controlledExecution(env, { kind: 'follow_on', rule: rule.id, event: event.key, learner: event.learner, authority: rule.enabled_by, unit: rule.unit_id, input: { ...event, trigger: rule.trigger, target: rule.target_course_id }, manual: replay }, async artifact => {
    const prior = await one(env, 'SELECT id FROM beam_assignments WHERE id=?', artifact)
    const result = prior ? 'assigned' : await outcome(env, rule, event)
    insist(result !== 'target_unavailable', 'target_unavailable', 409)
    const recorded = depth >= MAX_DEPTH ? 'depth_limit' : result === 'would_assign' ? 'assigned' : result
    let assignment = prior?.id ?? null, final = recorded
    if (recorded === 'assigned' && !prior) {
      const business = await requireBusiness(env)
      const { created } = await insertAssignments(env, { id: rule.enabled_by } as Actor, [{ id: artifact, learner: event.learner, course: rule.target_course_id, dueDate: addDays(localDate(now(), business.timezone), rule.due_days), dueTime: '17:00', timezone: business.timezone, reason: `rule ${rule.id}` }], 'assignment.rule', depth + 1)
      assignment = created[0] ?? null
      if (!assignment) final = 'already_open'
    }
    await commit(env, [stmt(env, `INSERT INTO beam_automation_runs(id,rule_id,event_key,learner_id,source_assignment_id,target_assignment_id,outcome,replay,at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(rule_id,event_key) DO UPDATE SET target_assignment_id=excluded.target_assignment_id,outcome=excluded.outcome,replay=excluded.replay,at=excluded.at`, newId(), rule.id, event.key, event.learner, event.assignment, assignment, final, replay ? 1 : 0, now())], { actor: rule.enabled_by, action: 'automation.run', subject: rule.id, detail: { event: event.key, learner: event.learner, outcome: final, replay } })
    return final
  })
}

/** A live event from enrollment, completion or a quiz attempt: every active rule on that course and trigger runs. */
export async function followOn(env: Bindings, trigger: Trigger, only: { assignment?: string; completion?: string }, depth = 0) {
  const course = only.completion ? await one<{ course_id: string }>(env, 'SELECT course_id FROM beam_completions WHERE id = ?', only.completion) : await one<{ course_id: string }>(env, 'SELECT course_id FROM beam_assignments WHERE id = ?', only.assignment)
  if (!course) return
  for (const rule of await all(env, "SELECT * FROM beam_automation_rules WHERE source_course_id = ? AND trigger = ? AND state = 'active' ORDER BY created_at", course.course_id, trigger))
    for (const event of await events(env, rule, only)) await run(env, rule, event, depth, false)
}

/** Replays an active rule over every event in the records now; events it already acted on are left alone. */
export async function replayRule(env: Bindings, actor: Actor, input: Input) {
  const rule = await requireRule(env, actor, input.text('rule'))
  insist(rule.state === 'active', 'rule_not_active', 409)
  const results: Record<string, number> = {}
  for (const event of await events(env, rule)) { const result = await run(env, rule, event, 0, true); results[result] = (results[result] ?? 0) + 1 }
  return { id: rule.id, results }
}

/** The rules this person may manage, with their dry run and their latest runs. */
export async function automationView(env: Bindings, actor: Actor) {
  requireAdministrator(actor)
  const units = actor.owner ? null : JSON.stringify(actor.adminUnits)
  const rules = await all(env, `SELECT r.id, r.name, r.trigger, r.source_course_id AS sourceCourse, s.title AS sourceTitle, r.target_course_id AS targetCourse, t.title AS targetTitle, r.due_days AS dueDays, r.min_percent AS minPercent, r.team_id AS team, tm.name AS teamName, r.unit_id AS unit, r.state, r.created_at AS createdAt, r.previewed_at AS previewedAt, r.preview_json AS preview, r.enabled_at AS enabledAt
    FROM beam_automation_rules r JOIN beam_courses s ON s.id = r.source_course_id JOIN beam_courses t ON t.id = r.target_course_id LEFT JOIN beam_teams tm ON tm.id = r.team_id
    WHERE (? IS NULL OR r.unit_id IN (SELECT value FROM json_each(?))) ORDER BY r.created_at`, units, units)
  const runs = await all(env, `SELECT u.id, u.rule_id AS rule, u.event_key AS event, u.learner_id AS learner, m.name AS learnerName, u.source_assignment_id AS sourceAssignment, u.target_assignment_id AS targetAssignment, u.outcome, u.replay, u.at
    FROM beam_automation_runs u JOIN beam_members m ON m.id = u.learner_id WHERE u.rule_id IN (SELECT value FROM json_each(?)) ORDER BY u.at DESC, u.rowid DESC LIMIT 100`, JSON.stringify(rules.map(rule => rule.id)))
  return { rules: rules.map(rule => ({ ...rule, preview: rule.preview ? JSON.parse(rule.preview) : null }) as Row), runs }
}
