// AUTO-001: dynamic learner audiences. The owner (acting as admin), or a learning administrator for one of their units,
// saves an audience: a fixed rule over the ORG-001 directory and optionally a course it enrolls. Conditions of
// different kinds all hold (AND); the values listed for one kind are alternatives (OR); a kind left empty does not
// narrow. Role, location and department match case-insensitively; teams by id; manager by the directory manager;
// employment by state (active, on leave) with active only unless the rule names leave, and someone who has left the
// business never matches; a custom field by one of its values; "hired within N days" and "transferred within N days"
// hold when the hire or transfer date is on or after the business-zone date N days before today (a future hire date
// holds). A learning administrator's audience only ever holds people in their unit's teams.
// An audience stays a draft until its write-free preview is recorded; once active, every synchronization (the button,
// activation, and each roster change: imports, directory edits, team members, resolved conflicts) adds the people who
// now match and closes the stints of those who no longer do, with the reason (no longer matches, on leave, left the
// business, excluded). Joining enrolls the person in the audience's course, unless they already hold an open
// assignment or a completion of it, so repeated runs never duplicate work; leaving cancels only the open assignment the
// audience made, and completions, attempts and evidence stay. An exclusion keeps its reason and who made it.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { insertAssignments } from './assignments'
import { controlledExecution } from './automation-execution'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { requireBusiness } from './people'
import { addDays, localDate } from './time'
import { requireCourseRole } from './units'

export interface AudienceRule { jobRoles: string[]; locations: string[]; departments: string[]; teams: string[]; managers: string[]; employment: string[]; custom: Record<string, string[]>; hiredWithinDays: number | null; transferredWithinDays: number | null }
type Outcome = 'member' | 'assigned' | 'already_open' | 'already_completed' | 'course_unavailable'
type LeaveReason = 'no_longer_matches' | 'on_leave' | 'left_business' | 'excluded'
interface Candidate { id: string; name: string; employment: string; job_role: string | null; location: string | null; department: string | null; manager_id: string | null; hire_date: string | null; transfer_date: string | null; custom_json: string }

const requireAdministrator = (actor: Actor) => insist(!actor.agent && !actor.viewAs && (actor.owner || actor.adminUnits.length > 0), 'forbidden', 403)

async function requireAudience(env: Bindings, actor: Actor, id: string) {
  requireAdministrator(actor)
  const audience = await one(env, 'SELECT * FROM beam_audiences WHERE id = ?', id)
  insist(audience && (actor.owner || (audience.unit_id && actor.adminUnits.includes(audience.unit_id))), 'audience_not_found', 404)
  return audience
}

/** Lists from a form (one value per line) or JSON (an array). */
const many = (input: Input, name: string) => [...new Set(input.list(name).flatMap(value => value.split(/\r?\n/)).map(value => value.trim()).filter(Boolean))]

export async function saveAudience(env: Bindings, actor: Actor, input: Input) {
  requireAdministrator(actor)
  const name = input.text('name', { max: 120 })
  const unit = actor.owner ? null : input.text('unit', { optional: true, max: 64 }) || actor.adminUnits[0]
  insist(unit === null || actor.adminUnits.includes(unit), 'outside_your_units', 403)
  const employment = many(input, 'employment')
  insist(employment.every(value => value === 'active' || value === 'leave'), 'invalid_employment')
  const rule: AudienceRule = {
    jobRoles: many(input, 'jobRoles'), locations: many(input, 'locations'), departments: many(input, 'departments'), teams: many(input, 'teams'), managers: many(input, 'managers'),
    employment: employment.length ? employment : ['active'], custom: {},
    hiredWithinDays: input.integer('hiredWithinDays', { min: 0, max: 3650, optional: true }), transferredWithinDays: input.integer('transferredWithinDays', { min: 0, max: 3650, optional: true }),
  }
  for (const field of await all<{ id: string }>(env, 'SELECT id FROM beam_directory_fields')) { const values = many(input, `custom_${field.id}`); if (values.length) rule.custom[field.id] = values }
  for (const team of rule.teams) insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ? AND (? IS NULL OR unit_id = ?)', team, unit, unit), 'team_not_found', 404)
  for (const manager of rule.managers) insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', manager), 'manager_not_found', 404)
  insist(rule.jobRoles.length + rule.locations.length + rule.departments.length + rule.teams.length + rule.managers.length + Object.keys(rule.custom).length > 0 || rule.hiredWithinDays !== null || rule.transferredWithinDays !== null, 'audience_rule_required')
  const course = input.text('course', { optional: true, max: 64 }) || null
  const dueDays = course ? input.integer('dueDays', { min: 1, max: 365 }) : null
  if (course) {
    insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id = ? AND published_revision_id IS NOT NULL AND retired_at IS NULL', course), 'course_not_found', 404)
    await requireCourseRole(env, actor, course, 'manager')
  }
  const id = newId()
  await commit(env, [stmt(env, "INSERT INTO beam_audiences (id, name, rule_json, course_id, due_days, unit_id, state, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)", id, name, JSON.stringify(rule), course, dueDays, unit, actor.id, now())],
    { actor, action: 'audience.save', subject: id, detail: { name, rule, course, dueDays, unit } })
  return { id }
}

/** Everyone the rule holds now, by id, with why the rest of the current stints would close. */
async function matching(env: Bindings, audience: Row) {
  const rule = JSON.parse(audience.rule_json) as AudienceRule
  const today = localDate(now(), (await requireBusiness(env)).timezone)
  const people = await all<Candidate>(env, `SELECT id, name, employment, job_role, location, department, manager_id, hire_date, transfer_date, custom_json FROM beam_members
    WHERE ?1 IS NULL OR id IN (SELECT tm.member_id FROM beam_team_members tm JOIN beam_teams t ON t.id = tm.team_id WHERE t.unit_id = ?1) ORDER BY name, id`, audience.unit_id)
  const teams = new Map<string, Set<string>>()
  for (const row of await all<{ member_id: string; team_id: string }>(env, 'SELECT member_id, team_id FROM beam_team_members')) (teams.get(row.member_id) ?? teams.set(row.member_id, new Set()).get(row.member_id)!).add(row.team_id)
  const fold = (value: string | null) => (value ?? '').trim().toLowerCase()
  const oneOf = (wanted: string[], value: string | null) => !wanted.length || wanted.some(item => fold(item) === fold(value))
  const within = (days: number | null, date: string | null) => days === null || (!!date && date >= addDays(today, -days))
  // Fields apart from employment: a person who stops matching these "no longer matches"; one who matches them but not
  // the employment condition is "on leave" or "left the business".
  const fields = (person: Candidate) => {
    const custom = JSON.parse(person.custom_json) as Record<string, string>
    return oneOf(rule.jobRoles, person.job_role) && oneOf(rule.locations, person.location) && oneOf(rule.departments, person.department)
      && (!rule.teams.length || rule.teams.some(team => teams.get(person.id)?.has(team))) && (!rule.managers.length || rule.managers.includes(person.manager_id ?? ''))
      && Object.entries(rule.custom).every(([field, values]) => oneOf(values, custom[field] ?? null)) && within(rule.hiredWithinDays, person.hire_date) && within(rule.transferredWithinDays, person.transfer_date)
  }
  const matches = new Map<string, string>(), names = new Map<string, string>(), outside = new Map<string, LeaveReason>()
  for (const person of people) {
    names.set(person.id, person.name)
    if (!fields(person)) outside.set(person.id, 'no_longer_matches')
    else if (person.employment === 'terminated') outside.set(person.id, 'left_business')
    else if (!rule.employment.includes(person.employment)) outside.set(person.id, 'on_leave')
    else matches.set(person.id, person.name)
  }
  return { matches, names, outside }
}

/** What joining would do for this person's enrollment in the audience's course. */
async function enrollment(env: Bindings, audience: Row, member: string): Promise<Outcome> {
  if (!audience.course_id) return 'member'
  const course = await one(env, 'SELECT published_revision_id, retired_at FROM beam_courses WHERE id = ?', audience.course_id)
  if (!course?.published_revision_id || course.retired_at) return 'course_unavailable'
  if (await one(env, "SELECT 1 FROM beam_assignments WHERE learner_id = ? AND course_id = ? AND status = 'open'", member, audience.course_id)) return 'already_open'
  if (await one(env, 'SELECT 1 FROM beam_completions WHERE learner_id = ? AND course_id = ?', member, audience.course_id)) return 'already_completed'
  return 'assigned'
}

/** The changes a synchronization would make now: who joins (with what enrollment), who leaves and why, who stays. */
async function plan(env: Bindings, audience: Row) {
  const { matches, names, outside } = await matching(env, audience)
  const current = await all<{ id: string; member_id: string; assignment_id: string | null }>(env, 'SELECT id, member_id, assignment_id FROM beam_audience_members WHERE audience_id = ? AND left_at IS NULL', audience.id)
  const excluded = new Set((await all<{ member_id: string }>(env, 'SELECT member_id FROM beam_audience_exclusions WHERE audience_id = ? AND lifted_at IS NULL', audience.id)).map(row => row.member_id))
  const inside = new Set(current.map(row => row.member_id))
  const leaves = current.filter(row => excluded.has(row.member_id) || !matches.has(row.member_id))
    .map(row => ({ stint: row.id, member: row.member_id, name: names.get(row.member_id) ?? '', assignment: row.assignment_id, reason: (excluded.has(row.member_id) ? 'excluded' : outside.get(row.member_id) ?? 'no_longer_matches') as LeaveReason }))
  const joins = []
  for (const [member, name] of matches) if (!inside.has(member) && !excluded.has(member)) joins.push({ member, name, outcome: await enrollment(env, audience, member) })
  return { joins, leaves, stays: current.length - leaves.length, excluded: excluded.size }
}

/** The preview: what synchronizing would do now. It writes nothing but the time it was taken. */
export async function previewAudience(env: Bindings, actor: Actor, input: Input) {
  const audience = await requireAudience(env, actor, input.text('audience'))
  const preview = { at: now(), ...await plan(env, audience) }
  await commit(env, [stmt(env, 'UPDATE beam_audiences SET previewed_at = ? WHERE id = ?', preview.at, audience.id)], { actor, action: 'audience.preview', subject: audience.id, detail: { joins: preview.joins.length, leaves: preview.leaves.length } })
  return preview
}

/** Every join and departure is controlled before any membership or enrollment
 * changes. A join's reserved assignment survives a failed response and replay. */
async function syncOne(env: Bindings, actor: Actor, audience: Row, manual: boolean) {
  const { joins, leaves } = await plan(env, audience)
  const at = now(), joined: Row[] = [], left: Row[] = [], held: Row[] = []
  const business = await requireBusiness(env)
  const execute = (event: string, learner: string, input: unknown, perform: (artifact: string) => Promise<string>) => controlledExecution(env, { kind: 'audience', rule: audience.id, event, learner, authority: audience.enabled_by, unit: audience.unit_id, input, manual }, perform)
  for (const leave of leaves) {
    const result = await execute(`leave:${leave.stint}`, leave.member, leave, async () => {
      await commit(env, [
        stmt(env, 'UPDATE beam_audience_members SET left_at=?,left_reason=? WHERE id=? AND left_at IS NULL', at, leave.reason, leave.stint),
        ...(leave.assignment ? [stmt(env, "UPDATE beam_assignments SET status='cancelled' WHERE id=? AND status='open'", leave.assignment)] : []),
      ], { actor: audience.enabled_by, action: 'audience.leave', subject: leave.member, detail: { audience: audience.id, reason: leave.reason, assignment: leave.assignment } })
      left.push({ member: leave.member, name: leave.name, reason: leave.reason })
      return 'left'
    })
    if (result !== 'left' && result !== 'already_ran') held.push({ member: leave.member, outcome: result })
  }
  for (const join of joins) {
    const previous = await one(env, 'SELECT id FROM beam_audience_members WHERE audience_id=? AND member_id=? ORDER BY joined_at DESC,rowid DESC LIMIT 1', audience.id, join.member)
    const result = await execute(`join:${join.member}:${previous?.id ?? 'first'}`, join.member, { member: join.member, course: audience.course_id }, async artifact => {
      let outcome = join.outcome, assignment: string | null = null
      insist(outcome !== 'course_unavailable', 'target_unavailable', 409)
      const prior = await one(env, 'SELECT id FROM beam_assignments WHERE id=?', artifact)
      if (prior) { outcome = 'assigned'; assignment = prior.id }
      else if (outcome === 'assigned') {
        const { created } = await insertAssignments(env, { id: audience.enabled_by } as Actor, [{ id: artifact, learner: join.member, course: audience.course_id, dueDate: addDays(localDate(at, business.timezone), audience.due_days), dueTime: '17:00', timezone: business.timezone, reason: `audience ${audience.id}` }], 'assignment.audience')
        outcome = created.length ? 'assigned' : 'already_open'
        assignment = created[0] ?? null
      }
      await env.DB.prepare('INSERT OR IGNORE INTO beam_audience_members(id,audience_id,member_id,joined_at,outcome,assignment_id) VALUES(?,?,?,?,?,?)').bind(newId(), audience.id, join.member, at, outcome, assignment).run()
      joined.push({ member: join.member, name: join.name, outcome })
      return outcome
    })
    if (!['member','assigned','already_open','already_completed','already_ran'].includes(result)) held.push({ member: join.member, outcome: result })
  }
  await commit(env, [stmt(env, 'UPDATE beam_audiences SET synced_at=? WHERE id=?', at, audience.id)], { actor, action: 'audience.sync', subject: audience.id, detail: { joined, left, held } })
  return { id: audience.id, joined, left, held }
}

/** Synchronizes every active audience (or one): after roster changes, on activation and from the button. */
export async function syncAudiences(env: Bindings, actor: Actor, only?: string, manual = false) {
  const results = []
  for (const audience of await all(env, "SELECT * FROM beam_audiences WHERE state = 'active' AND (? IS NULL OR id = ?) ORDER BY created_at", only ?? null, only ?? null)) results.push(await syncOne(env, actor, audience, manual))
  return results
}

export async function syncAudience(env: Bindings, actor: Actor, input: Input) {
  const audience = await requireAudience(env, actor, input.text('audience'))
  insist(audience.state === 'active', 'audience_not_active', 409)
  return (await syncAudiences(env, actor, audience.id, true))[0]
}

export async function setAudienceState(env: Bindings, actor: Actor, input: Input) {
  const audience = await requireAudience(env, actor, input.text('audience'))
  const state = input.text('state')
  insist(state === 'active' || state === 'paused', 'invalid_state')
  if (state === 'active') insist(audience.previewed_at, 'preview_required', 409)
  await commit(env, [stmt(env, "UPDATE beam_audiences SET state = ?, enabled_by = CASE WHEN ?2 = 'active' THEN ?3 ELSE enabled_by END, enabled_at = CASE WHEN ?2 = 'active' THEN ?4 ELSE enabled_at END WHERE id = ?5", state, state, actor.id, now(), audience.id)],
    { actor, action: state === 'active' ? 'audience.enable' : 'audience.pause', subject: audience.id })
  return { id: audience.id, state, ...(state === 'active' ? { sync: (await syncAudiences(env, actor, audience.id, true))[0] } : {}) }
}

/** Keeps a person out of an audience with a reason; their open audience assignment is withdrawn, their records stay. */
export async function excludeFromAudience(env: Bindings, actor: Actor, input: Input) {
  const audience = await requireAudience(env, actor, input.text('audience'))
  const member = input.text('member', { max: 64 }), reason = input.text('reason', { max: 500 })
  insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', member), 'person_not_found', 404)
  insist(!await one(env, 'SELECT 1 FROM beam_audience_exclusions WHERE audience_id = ? AND member_id = ? AND lifted_at IS NULL', audience.id, member), 'already_excluded', 409)
  await commit(env, [stmt(env, 'INSERT INTO beam_audience_exclusions (id, audience_id, member_id, reason, excluded_by, excluded_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), audience.id, member, reason, actor.id, now())],
    { actor, action: 'audience.exclude', subject: audience.id, detail: { member, reason } })
  return { id: audience.id, member, sync: audience.state === 'active' ? (await syncAudiences(env, actor, audience.id, true))[0] : null }
}

export async function includeInAudience(env: Bindings, actor: Actor, input: Input) {
  const audience = await requireAudience(env, actor, input.text('audience'))
  const member = input.text('member', { max: 64 })
  const result = await env.DB.batch([stmt(env, 'UPDATE beam_audience_exclusions SET lifted_by = ?, lifted_at = ? WHERE audience_id = ? AND member_id = ? AND lifted_at IS NULL', actor.id, now(), audience.id, member),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', now(), actor.id, 'audience.include', audience.id, JSON.stringify({ member }))])
  insist(result[0].meta.changes === 1, 'not_excluded', 404)
  return { id: audience.id, member, sync: audience.state === 'active' ? (await syncAudiences(env, actor, audience.id, true))[0] : null }
}

/** The people in the given audiences now (LIB-006 requirements read these). */
export async function audienceMembers(env: Bindings, audiences: string[]) {
  if (!audiences.length) return []
  return await all<{ audience: string; member: string; name: string }>(env, 'SELECT s.audience_id AS audience, s.member_id AS member, m.name FROM beam_audience_members s JOIN beam_members m ON m.id = s.member_id WHERE s.left_at IS NULL AND s.audience_id IN (SELECT value FROM json_each(?)) ORDER BY m.name', JSON.stringify(audiences))
}

/** The audiences this person may manage, each with its members, past stints with their reasons, and exclusions. */
export async function audiencesView(env: Bindings, actor: Actor) {
  requireAdministrator(actor)
  const units = actor.owner ? null : JSON.stringify(actor.adminUnits)
  const audiences = await all(env, `SELECT a.id, a.name, a.rule_json, a.course_id AS course, c.title AS courseTitle, a.due_days AS dueDays, a.unit_id AS unit, a.state, a.created_at AS createdAt, a.previewed_at AS previewedAt, a.enabled_at AS enabledAt, a.synced_at AS syncedAt
    FROM beam_audiences a LEFT JOIN beam_courses c ON c.id = a.course_id WHERE (? IS NULL OR a.unit_id IN (SELECT value FROM json_each(?))) ORDER BY a.created_at`, units, units)
  const ids = JSON.stringify(audiences.map(row => row.id))
  const stints = await all(env, `SELECT s.audience_id AS audience, s.member_id AS member, m.name, s.joined_at AS joinedAt, s.outcome, s.assignment_id AS assignment, s.left_at AS leftAt, s.left_reason AS leftReason
    FROM beam_audience_members s JOIN beam_members m ON m.id = s.member_id WHERE s.audience_id IN (SELECT value FROM json_each(?)) ORDER BY s.joined_at DESC, m.name`, ids)
  const exclusions = await all(env, `SELECT x.audience_id AS audience, x.member_id AS member, m.name, x.reason, b.name AS excludedBy, x.excluded_at AS excludedAt, x.lifted_at AS liftedAt
    FROM beam_audience_exclusions x JOIN beam_members m ON m.id = x.member_id JOIN beam_members b ON b.id = x.excluded_by WHERE x.audience_id IN (SELECT value FROM json_each(?)) ORDER BY x.excluded_at DESC`, ids)
  return {
    audiences: audiences.map(({ rule_json, ...row }) => ({ ...row, rule: JSON.parse(rule_json) as AudienceRule,
      members: stints.filter(stint => stint.audience === row.id && !stint.leftAt), history: stints.filter(stint => stint.audience === row.id && stint.leftAt),
      exclusions: exclusions.filter(item => item.audience === row.id) }) as Row),
  }
}
