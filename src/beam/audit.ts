// OPS-001: the decision audit. Every audited write (core.ts commit and the
// guarded inserts beside it) is one append-only row: who, when, what, the exact
// inputs, and the route (a person's session or an agent's preparation
// credential). The owner, acting as admin, searches and exports all of it; a
// learning administrator the events about their units, an auditor those about
// the completions shared with them. Only the owner appends a correction, a new
// event that explains an earlier one, never an edit. No door
// updates or deletes a row. Anonymous answers are recorded without the person
// (actor 'respondent', no content) and practice runs are never audited.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { SHARED } from './auditors'
import { all, commit, insist, one } from './core'
import type { Input } from './input'
import { requireBusiness } from './people'
import { cell } from './report'
import { addDays, zonedInstant } from './time'

/** Action prefixes behind each search category; an event belongs to the first category whose prefix it starts with. */
export const CATEGORIES: Record<string, { label: string; prefixes: string[] }> = {
  access: { label: 'Access and roles', prefixes: ['person.', 'roster.', 'admin.', 'role.', 'auditor.', 'team.', 'unit.', 'course.authors', 'course.reviewer', 'course.selfreview', 'access.', 'agent.issue', 'business.', 'view.'] },
  content: { label: 'Content and publication', prefixes: ['course.', 'revision.', 'source.', 'proposal.', 'notice.', 'scenario.', 'acknowledgment.'] },
  due: { label: 'Due dates', prefixes: ['assignment.due'] },
  enrollment: { label: 'Enrollment', prefixes: ['assignment.', 'path.', 'attempt.grant', 'accommodation.', 'audience.'] },
  evidence: { label: 'Evidence and results', prefixes: ['completion.', 'offline.', 'practical.', 'quiz.', 'lesson.', 'import.', 'history.'] },
  agent: { label: 'Agent work', prefixes: ['agent.', 'questions.', 'reminder.'] },
  automatic: { label: 'Automatic outcomes', prefixes: ['quiz.expire'] },
  discussion: { label: 'Discussions and moderation', prefixes: ['discussion.'] },
  correction: { label: 'Corrections', prefixes: ['audit.correct'] },
}

/** Actions Beam takes by rule rather than by a person's decision; the actor is whoever's request ran the rule. */
const AUTOMATIC: Record<string, string> = { 'quiz.expire': 'Timed quiz scored when its time limit passed (LEARN-018): only answers saved before the limit count' }

export interface AuditFilters { q: string; category: string; actor: string; from: string; to: string }

export function auditFilters(url: URL): AuditFilters {
  const get = (name: string) => (url.searchParams.get(name) ?? '').trim()
  return { q: get('q').slice(0, 200), category: get('category'), actor: get('actor'), from: get('from'), to: get('to') }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const like = (text: string) => `%${text.replace(/[\\%_]/g, char => `\\${char}`)}%`

/** Events matching the filters, newest first (at most 1000), each with the corrections appended to it. From and to are
 * whole days in the business's time zone, both inclusive. */
export async function auditLog(env: Bindings, actor: Actor, filters: AuditFilters) {
  insist(actor.owner || actor.adminUnits.length || actor.auditor, 'forbidden', 403)
  const zone = (await requireBusiness(env)).timezone
  const where: string[] = [], binds: unknown[] = []
  if (!actor.owner) { const scope = readerScope(actor); where.push(scope.sql); binds.push(...scope.binds) }
  if (filters.q) { where.push("(a.action LIKE ? ESCAPE '\\' OR a.subject LIKE ? ESCAPE '\\' OR a.detail LIKE ? ESCAPE '\\' OR m.name LIKE ? ESCAPE '\\' OR m.email LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' OR s.email LIKE ? ESCAPE '\\')"); binds.push(...Array(7).fill(like(filters.q))) }
  if (filters.category) {
    const category = CATEGORIES[filters.category]
    insist(category, 'invalid_category')
    where.push(`(${category.prefixes.map(() => 'a.action LIKE ?').join(' OR ')})`); binds.push(...category.prefixes.map(prefix => `${prefix}%`))
  }
  if (filters.actor) { where.push('a.actor = ?'); binds.push(filters.actor) }
  if (filters.from) { insist(DAY.test(filters.from), 'invalid_from'); where.push('a.at >= ?'); binds.push(zonedInstant(filters.from, '00:00', zone)) }
  if (filters.to) { insist(DAY.test(filters.to), 'invalid_to'); where.push('a.at < ?'); binds.push(zonedInstant(addDays(filters.to, 1), '00:00', zone)) }
  // A subject that is a person carries their name, so a search for someone finds what was done to them as well as by them.
  const rows = await all<{ id: number; at: number; actor: string; actorName: string | null; via: string | null; action: string; subject: string; subjectName: string | null; detail: string }>(env,
    `SELECT a.id, a.at, a.actor, m.name AS actorName, a.via, a.action, a.subject, s.name AS subjectName, a.detail FROM beam_audit a LEFT JOIN beam_members m ON m.id = a.actor LEFT JOIN beam_members s ON s.id = a.subject
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT 1000`, ...binds)
  const corrections = await all<{ id: number; at: number; subject: string; actorName: string | null; detail: string }>(env,
    "SELECT a.id, a.at, a.subject, m.name AS actorName, a.detail FROM beam_audit a LEFT JOIN beam_members m ON m.id = a.actor WHERE a.action = 'audit.correct' AND a.subject IN (SELECT value FROM json_each(?)) ORDER BY a.id",
    JSON.stringify(rows.map(row => String(row.id))))
  return {
    zone,
    events: rows.map(row => {
      const via = row.via ? JSON.parse(row.via) as { kind: string; session: string } : null
      return {
        id: row.id, at: row.at, action: row.action, subject: row.subject, subjectName: row.subjectName, detail: JSON.parse(row.detail),
        actor: row.actor, actorName: row.actor === 'respondent' ? 'Anonymous respondent' : row.actorName ?? row.actor,
        // An agent's change is attributed to the person whose session delegated the credential (BEAM-14).
        via: via ? { kind: via.kind, session: via.session, delegatedBy: row.actorName ?? row.actor } : null,
        automatic: AUTOMATIC[row.action] ?? null,
        corrections: corrections.filter(correction => correction.subject === String(row.id)).map(correction => ({ id: correction.id, at: correction.at, by: correction.actorName, explanation: JSON.parse(correction.detail).explanation as string })),
      }
    }),
  }
}

/** A non-owner reader's events. A learning administrator: those whose subject is one of their units' teams, courses or
 * people, or those people's assignments, attempts and completions. An auditor: the recording of each completion their
 * grant shares. Both together see either. */
function readerScope(actor: Actor) {
  const parts: string[] = [], binds: unknown[] = []
  if (actor.adminUnits.length) {
    const units = JSON.stringify(actor.adminUnits)
    const teams = 'SELECT id FROM beam_teams WHERE unit_id IN (SELECT value FROM json_each(?))'
    const people = `SELECT member_id FROM beam_team_members WHERE team_id IN (${teams})`
    parts.push(`a.subject IN (${teams})`, 'a.subject IN (SELECT id FROM beam_courses WHERE unit_id IN (SELECT value FROM json_each(?)))', `a.subject IN (${people})`,
      `a.subject IN (SELECT id FROM beam_assignments WHERE learner_id IN (${people}))`, `a.subject IN (SELECT id FROM beam_completions WHERE learner_id IN (${people}))`,
      `a.subject IN (SELECT t.id FROM beam_attempts t JOIN beam_assignments s ON s.id = t.assignment_id WHERE s.learner_id IN (${people}))`)
    binds.push(units, units, units, units, units, units)
  }
  if (actor.auditor) { parts.push(`(a.action = 'completion.record' AND a.subject IN (${SHARED}))`); binds.push(actor.id, Date.now()) }
  return { sql: `(${parts.join(' OR ')})`, binds }
}

/** The owner appends an explanation to an event; the event itself never changes. */
export async function correctAudit(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const event = input.integer('event', { min: 1, max: Number.MAX_SAFE_INTEGER })!
  insist(await one(env, 'SELECT 1 FROM beam_audit WHERE id = ?', event), 'event_not_found', 404)
  const explanation = input.text('explanation', { max: 1000 })
  await commit(env, [], { actor, action: 'audit.correct', subject: String(event), detail: { explanation } })
  return { event, explanation }
}

type Event = Awaited<ReturnType<typeof auditLog>>['events'][number]
const COLUMNS: [string, (event: Event) => unknown][] = [
  ['Event', event => event.id], ['At (UTC)', event => new Date(event.at).toISOString()], ['Actor', event => event.actorName], ['Actor id', event => event.actor],
  ['Route', event => event.via ? `agent preparation credential delegated by ${event.via.delegatedBy}` : 'signed-in session'], ['Action', event => event.action], ['Subject person', event => event.subjectName ?? ''],
  ['Automatic rule', event => event.automatic ?? ''], ['Subject', event => event.subject], ['Inputs', event => JSON.stringify(event.detail)],
  ['Corrections', event => event.corrections.map(correction => `${new Date(correction.at).toISOString()} ${correction.by}: ${correction.explanation}`).join(' | ')],
]

/** The same events as the page, as CSV with spreadsheet formulas kept inert. */
export function auditCsv(log: Awaited<ReturnType<typeof auditLog>>) {
  return [COLUMNS.map(([name]) => cell(name)).join(','), ...log.events.map(event => COLUMNS.map(([, value]) => cell(value(event))).join(','))].join('\r\n') + '\r\n'
}
