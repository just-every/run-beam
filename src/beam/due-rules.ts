// AUTO-003: relative due dates on role paths. Each path requirement is due a number of days after an anchor: the
// enrollment (the day the path is assigned), the person's hire date or transfer date (ORG-001), or the completion of
// its prerequisite; or on a fixed date. Dates are calendar days in the learner's time zone (their directory time zone,
// else the business zone), due at 17:00 local time, so a daylight-saving change moves the UTC instant, never the local
// hour. A person with no hire or transfer date is not assigned that requirement and the result says why. A
// prerequisite-relative requirement is first due its days after the prerequisite's own due date; when the
// prerequisite is completed, the open assignment's due date becomes its days after that completion's local date,
// recorded in the audit with the date it replaces. A preview computes every date without writing. A new path revision
// changes only assignments made after it: existing assignments keep their revision, rule and dates.
import type { Bindings } from '../auth.server'
import { all, insist, now, one, stmt } from './core'
import type { Input } from './input'
import { requireBusiness } from './people'
import { addDays, localDate, zonedInstant } from './time'

export const ANCHORS = ['enrollment', 'hire', 'transfer', 'prerequisite', 'fixed'] as const
export type Anchor = typeof ANCHORS[number]
export const DUE_TIME = '17:00'
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** The anchors and fixed dates a path revision form or JSON body gives, one per requirement row. */
export function dueRules(input: Input) {
  const anchors = input.list('dueAnchors', { keepEmpty: true }), dates = input.list('dueOn', { keepEmpty: true })
  return (index: number, prerequisite: string | null) => {
    const anchor = (anchors[index] || 'enrollment') as Anchor
    insist(ANCHORS.includes(anchor), 'invalid_due_anchor')
    insist(anchor !== 'prerequisite' || prerequisite, 'prerequisite_anchor_needs_prerequisite')
    const dueOn = anchor === 'fixed' ? dates[index] ?? '' : null
    if (dueOn !== null) insist(DATE.test(dueOn) && new Date(`${dueOn}T00:00:00Z`).toISOString().startsWith(dueOn), 'invalid_due_on')
    return { anchor, dueOn }
  }
}

interface Requirement { course_id: string; prerequisite_course_id: string | null; due_days: number; due_anchor: Anchor; due_on: string | null; renewal_days: number | null }
interface Person { id: string; name: string; hire_date: string | null; transfer_date: string | null; time_zone: string | null }
export interface Due { learner: string; name: string; course: string; anchor: Anchor; dueDate: string | null; dueAt: number | null; timezone: string; skipped: string | null }

/** Every learner's due date for every requirement of the path revision, as assigning it now would set them. */
export async function computeDues(env: Bindings, revision: string, learners: string[]): Promise<{ requirements: Requirement[]; dues: Due[] }> {
  const business = await requireBusiness(env), at = now()
  const requirements = await all<Requirement>(env, 'SELECT course_id, prerequisite_course_id, due_days, due_anchor, due_on, renewal_days FROM beam_path_requirements WHERE path_revision_id = ? ORDER BY position', revision)
  const dues: Due[] = []
  for (const learner of learners) {
    const person = (await one<Person>(env, 'SELECT id, name, hire_date, transfer_date, time_zone FROM beam_members WHERE id = ?', learner))!
    const timezone = person.time_zone || business.timezone, mine = new Map<string, Due>()
    const due = (requirement: Requirement, depth = 0): Due => {
      const known = mine.get(requirement.course_id)
      if (known) return known
      let dueDate: string | null = null, skipped: string | null = null
      if (requirement.due_anchor === 'enrollment') dueDate = addDays(localDate(at, timezone), requirement.due_days)
      else if (requirement.due_anchor === 'fixed') dueDate = requirement.due_on
      else if (requirement.due_anchor === 'hire') person.hire_date ? dueDate = addDays(person.hire_date, requirement.due_days) : skipped = 'no_hire_date'
      else if (requirement.due_anchor === 'transfer') person.transfer_date ? dueDate = addDays(person.transfer_date, requirement.due_days) : skipped = 'no_transfer_date'
      else {
        const before = requirements.find(item => item.course_id === requirement.prerequisite_course_id)!
        const earlier = depth < requirements.length ? due(before, depth + 1) : null
        if (earlier?.dueDate) dueDate = addDays(earlier.dueDate, requirement.due_days); else skipped = earlier?.skipped ?? 'prerequisite_cycle'
      }
      const result = { learner, name: person.name, course: requirement.course_id, anchor: requirement.due_anchor, dueDate, dueAt: dueDate ? zonedInstant(dueDate, DUE_TIME, timezone) : null, timezone, skipped }
      mine.set(requirement.course_id, result)
      return result
    }
    for (const requirement of requirements) dues.push(due(requirement))
  }
  return { requirements, dues }
}

/** After a completion: open prerequisite-relative assignments of that learner become due their days after it. */
export async function prerequisiteCompleted(env: Bindings, learner: string, course: string, completedAt: number, actor: string) {
  for (const assignment of await all<{ id: string; timezone: string; due_days: number; due_date: string; due_at: number }>(env, "SELECT id, timezone, due_days, due_date, due_at FROM beam_assignments WHERE learner_id = ? AND prerequisite_course_id = ? AND due_anchor = 'prerequisite' AND status = 'open'", learner, course)) {
    const dueDate = addDays(localDate(completedAt, assignment.timezone), assignment.due_days)
    if (dueDate === assignment.due_date) continue
    const dueAt = zonedInstant(dueDate, DUE_TIME, assignment.timezone)
    await env.DB.batch([stmt(env, "UPDATE beam_assignments SET due_date = ?, due_time = ?, due_at = ? WHERE id = ? AND status = 'open'", dueDate, DUE_TIME, dueAt, assignment.id),
      stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) VALUES (?, ?, ?, ?, ?)', now(), actor, 'assignment.due.prerequisite', assignment.id, JSON.stringify({ from: { dueDate: assignment.due_date, dueAt: assignment.due_at }, to: { dueDate, dueAt }, reason: 'prerequisite completed' }))])
  }
}
