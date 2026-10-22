// REPORT-001: requirement coverage over the active roster. Each active employee a requirement applies to counts once per
// course, under every requirement that brings it with that policy's effective date: the current revision of their
// team's role path, an enrolling audience (AUTO-001) they are in, an assignment, or an external-certificate requirement
// (LIB-006). Their standing is current or expiring from a native completion, which always wins, or from a MOVE-009
// credit labelled with its source history; otherwise the open assignment's own state (exempt, deferred, overdue or
// open); otherwise missing. Filters narrow by team, role, location, course and status inside the reader's report scope,
// and the totals always add up to the required count.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, insist, now, type Row } from './core'
import { liveCredits } from './credits'
import { LATEST_EXCEPTION } from './exceptions'
import { externalReportRows } from './external'
import { closeAllExpired } from './learning'
import { expiringWindow, parseException } from './report'
import { IN_SCOPE, learnerScope, requireTeamScope } from './scope'
import { requireBusiness } from './people'
import { DAY, addDays, zonedInstant } from './time'

export const COVERAGE_STATUSES = ['current', 'expiring', 'overdue', 'open', 'deferred', 'exempt', 'missing'] as const
export type CoverageStatus = typeof COVERAGE_STATUSES[number]
export interface CoverageFilters { team: string; role: string; location: string; course: string; status: string; effective: string; requirement: string }
export interface Requirement { kind: 'path' | 'audience' | 'assignment' | 'external'; id: string; name: string; effectiveAt: number | null; revision?: number }

export function coverageFilters(url: URL): CoverageFilters {
  const value = (name: string) => (url.searchParams.get(name) ?? '').trim().slice(0, 160)
  const status = value('status') || 'all'
  insist(status === 'all' || (COVERAGE_STATUSES as readonly string[]).includes(status), 'invalid_status')
  const effective = value('effective')
  insist(!effective || /^\d{4}-\d{2}-\d{2}$/.test(effective), 'invalid_effective_date')
  return { team: value('team'), role: value('role'), location: value('location'), course: value('course'), status, effective, requirement: value('requirement') }
}

const tally = () => Object.fromEntries([['required', 0], ...COVERAGE_STATUSES.map(status => [status, 0])]) as Record<'required' | CoverageStatus, number>

export async function coverageReport(env: Bindings, actor: Actor, filters: CoverageFilters) {
  const scope = learnerScope(actor, 'reports')
  if (filters.team) requireTeamScope(actor, filters.team, 'reports')
  await closeAllExpired(env, actor)
  const at = now(), window = await expiringWindow(env), soon = at + window.days * DAY
  // A policy effective date narrows the requirements to those in force by the end of that day in the business zone.
  const effectiveBy = filters.effective ? zonedInstant(addDays(filters.effective, 1), '00:00', (await requireBusiness(env)).timezone) : null
  // The active roster this reader may see; people on leave or gone are not counted. Role and location are directory
  // fields (ORG-001, ct 19 Oct): only the owner, the person, their units' learning administrators and their team managers
  // read them, so other readers neither see nor filter or group by them.
  const everyone = await all(env, `SELECT m.id, m.name, m.job_role AS role, m.location FROM beam_members m WHERE m.employment = 'active' AND ${IN_SCOPE('m.id')}
      AND (? = '' OR m.id IN (SELECT member_id FROM beam_team_members WHERE team_id = ?)) ORDER BY m.name, m.id`, scope, scope, filters.team, filters.team)
  const directory = actor.owner ? null : new Set([actor.id, ...(await all(env, `SELECT DISTINCT tm.member_id AS id FROM beam_team_members tm JOIN beam_teams t ON t.id = tm.team_id
      WHERE t.unit_id IN (SELECT value FROM json_each(?)) OR tm.team_id IN (SELECT value FROM json_each(?))`, JSON.stringify(actor.agent ? [] : actor.adminUnits), JSON.stringify(actor.managedTeams))).map(row => row.id as string)])
  const shown = everyone.map(person => directory === null || directory.has(person.id) ? person : { ...person, role: null, location: null, hidden: true })
  const roster = shown.filter(person => (!filters.role || person.role === filters.role) && (!filters.location || person.location === filters.location))
  const options = { roles: [...new Set(shown.map(person => person.role).filter(Boolean))].sort() as string[], locations: [...new Set(shown.map(person => person.location).filter(Boolean))].sort() as string[] }
  const people = new Map(roster.map(row => [row.id as string, row]))
  const teams = new Map<string, { id: string; name: string }[]>()
  for (const row of await all(env, 'SELECT tm.member_id AS member, t.id, t.name FROM beam_team_members tm JOIN beam_teams t ON t.id = tm.team_id ORDER BY t.name, t.id'))
    if (people.has(row.member)) teams.set(row.member, [...(teams.get(row.member) ?? []), { id: row.id, name: row.name }])
  const required = new Map<string, { learner: string; course: string; requirements: Requirement[] }>()
  const need = (learner: string, course: string, requirement: Requirement) => {
    if (!people.has(learner) || (filters.course && filters.course !== course) || (effectiveBy !== null && requirement.effectiveAt !== null && requirement.effectiveAt >= effectiveBy)) return
    if (filters.requirement && filters.requirement !== `${requirement.kind}:${requirement.id}`) return
    const key = `${learner}:${course}`, item = required.get(key) ?? { learner, course, requirements: [] }
    if (!item.requirements.some(other => other.kind === requirement.kind && other.id === requirement.id)) item.requirements.push(requirement)
    required.set(key, item)
  }
  for (const row of await all(env, `SELECT p.id, p.name, r.number, r.created_at AS effectiveAt, q.course_id AS course, tm.member_id AS learner FROM beam_paths p
      JOIN beam_path_revisions r ON r.id = p.current_revision_id JOIN beam_path_requirements q ON q.path_revision_id = r.id JOIN beam_team_members tm ON tm.team_id = p.team_id`))
    need(row.learner, row.course, { kind: 'path', id: row.id, name: row.name, revision: row.number, effectiveAt: row.effectiveAt })
  for (const row of await all(env, `SELECT a.id, a.name, a.course_id AS course, a.enabled_at AS effectiveAt, m.member_id AS learner FROM beam_audiences a
      JOIN beam_audience_members m ON m.audience_id = a.id AND m.left_at IS NULL WHERE a.course_id IS NOT NULL AND a.state = 'active'`))
    need(row.learner, row.course, { kind: 'audience', id: row.id, name: row.name, effectiveAt: row.effectiveAt })
  for (const row of await all(env, "SELECT id, learner_id AS learner, course_id AS course, reason, assigned_at AS effectiveAt FROM beam_assignments WHERE status IN ('open', 'completed')"))
    need(row.learner, row.course, { kind: 'assignment', id: row.id, name: row.reason, effectiveAt: row.effectiveAt })

  const key = (row: Row) => `${row.learner}:${row.course}`
  const latest = new Map<string, Row>(), open = new Map<string, Row>(), credits = new Map<string, Row>(), history = new Map<string, number>()
  for (const row of await all(env, `SELECT c.id, c.learner_id AS learner, c.course_id AS course, c.course_revision_id AS revision, r.number AS revisionNumber, c.completed_at AS completedAt, c.expires_at AS expiresAt, c.method
      FROM beam_completions c JOIN beam_course_revisions r ON r.id = c.course_revision_id ORDER BY c.completed_at DESC, c.rowid DESC`)) if (!latest.has(key(row))) latest.set(key(row), row)
  for (const row of await all(env, `SELECT a.id, a.learner_id AS learner, a.course_id AS course, a.course_revision_id AS revision, r.number AS revisionNumber, a.due_at AS dueAt, a.timezone, ${LATEST_EXCEPTION('a.id')} AS exception
      FROM beam_assignments a JOIN beam_course_revisions r ON r.id = a.course_revision_id WHERE a.status = 'open' ORDER BY a.due_at, a.id`)) if (!open.has(key(row))) open.set(key(row), row)
  for (const row of await liveCredits(env)) if (row.expiresAt > at && !credits.has(`${row.member}:${row.course}`)) credits.set(`${row.member}:${row.course}`, row)
  for (const row of await all(env, "SELECT payload FROM beam_imported_history WHERE kind = 'completion'")) {
    const item = JSON.parse(row.payload)
    if (item.member && item.mappedCourse) history.set(`${item.member}:${item.mappedCourse}`, (history.get(`${item.member}:${item.mappedCourse}`) ?? 0) + 1)
  }
  const titles = new Map((await all(env, 'SELECT id, title FROM beam_courses')).map(row => [row.id as string, row.title as string]))

  const rows: Row[] = [...required.values()].map(item => {
    const id = `${item.learner}:${item.course}`, completion = latest.get(id), credit = credits.get(id), assignment = open.get(id)
    const native = completion && (!completion.expiresAt || completion.expiresAt > at) ? completion : null
    let status: CoverageStatus, evidence: Row | null = null
    if (native) {
      status = native.expiresAt && native.expiresAt <= soon ? 'expiring' : 'current'
      evidence = { kind: 'completion', completion: native.id, revision: native.revision, revisionNumber: native.revisionNumber, completedAt: native.completedAt, expiresAt: native.expiresAt, method: native.method }
    } else if (credit) {
      status = credit.expiresAt <= soon ? 'expiring' : 'current'
      evidence = { kind: 'credit', label: `credited from ${credit.source} history`, source: credit.source, history: credit.history, completedOn: credit.completedOn, expiresAt: credit.expiresAt,
        decision: { id: credit.credit, reason: credit.reason, intervalDays: credit.intervalDays, approvedAt: credit.approvedAt, approvedBy: credit.approvedByName } }
    } else if (assignment) {
      const exception = parseException(assignment.exception, at)
      status = exception?.active ? (exception.kind === 'exemption' ? 'exempt' : 'deferred') : assignment.dueAt < at ? 'overdue' : 'open'
      evidence = { kind: 'assignment', assignment: assignment.id, revision: assignment.revision, revisionNumber: assignment.revisionNumber, dueAt: assignment.dueAt, timezone: assignment.timezone, exception }
    } else status = 'missing'
    const person = people.get(item.learner)!
    return { learner: item.learner, learnerName: person.name, role: person.role ?? null, location: person.location ?? null, directoryHidden: !!person.hidden, teams: teams.get(item.learner) ?? [],
      course: item.course, courseTitle: titles.get(item.course) ?? item.course, status, requirements: item.requirements, evidence,
      lapsed: completion && !native ? { completion: completion.id, revisionNumber: completion.revisionNumber, expiresAt: completion.expiresAt } : null, importedHistory: history.get(id) ?? 0 }
  })
  // LIB-006 requirements read the same roster; an approved certificate is current or expiring, otherwise missing.
  for (const row of await externalReportRows(env, scope, { course: filters.course, team: filters.team }, at, window.days)) {
    const person = people.get(row.learner)
    if (!person || (filters.requirement && filters.requirement !== `external:${row.course}`)) continue
    rows.push({ learner: row.learner, learnerName: person.name, role: person.role ?? null, location: person.location ?? null, directoryHidden: !!person.hidden, teams: teams.get(row.learner) ?? [],
      course: row.course, courseTitle: row.courseTitle, status: row.status === 'completed' ? 'current' : row.status, requirements: [{ kind: 'external', id: row.course, name: row.courseTitle, effectiveAt: null }],
      evidence: row.completion ? { kind: 'external', certificate: row.certificate, completedAt: row.completedAt, expiresAt: row.expiresAt } : null, lapsed: null, importedHistory: 0 })
  }
  rows.sort((a, b) => a.learnerName.localeCompare(b.learnerName) || a.courseTitle.localeCompare(b.courseTitle))

  const summary = tally()
  const groups = { course: new Map<string, Row>(), role: new Map<string, Row>(), location: new Map<string, Row>(), team: new Map<string, Row>(), requirement: new Map<string, Row>() }
  const add = (group: Map<string, Row>, id: string, label: string, status: CoverageStatus, extra: Row = {}) => {
    const entry = group.get(id) ?? { id, label, ...extra, ...tally() }
    entry.required++; entry[status]++
    group.set(id, entry)
  }
  for (const row of rows) {
    summary.required++; summary[row.status as CoverageStatus]++
    add(groups.course, row.course, row.courseTitle, row.status)
    add(groups.role, row.directoryHidden ? '-' : row.role ?? '', row.directoryHidden ? 'Not shown to you' : row.role ?? 'No role', row.status)
    add(groups.location, row.directoryHidden ? '-' : row.location ?? '', row.directoryHidden ? 'Not shown to you' : row.location ?? 'No location', row.status)
    for (const team of row.teams.length ? row.teams : [{ id: '', name: 'No team' }]) add(groups.team, team.id, team.name, row.status)
    for (const requirement of row.requirements) add(groups.requirement, `${requirement.kind}:${requirement.id}`, requirement.name, row.status, { kind: requirement.kind, effectiveAt: requirement.effectiveAt, revision: requirement.revision ?? null })
  }
  const listed = filters.status === 'all' ? rows : rows.filter(row => row.status === filters.status)
  const sorted = (group: Map<string, Row>) => [...group.values()].sort((a, b) => b.required - a.required || a.label.localeCompare(b.label))
  return { filters, asOf: at, window, options, activeRoster: roster.length, people: new Set(rows.map(row => row.learner)).size, summary,
    groups: { course: sorted(groups.course), role: sorted(groups.role), location: sorted(groups.location), team: sorted(groups.team), requirement: sorted(groups.requirement) }, rows: listed }
}
