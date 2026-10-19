// AGENT-003: the smallest useful intervention. A manager (or the owner) records a diagnosis of an error pattern for
// one directory job role with its evidence; a reviewer or the owner who did not record it reviews it. From a reviewed
// diagnosis an agent (or person) proposes options (clarification, targeted practice, assessor session, limited cohort
// assignment, process change) beside the broad-course alternative, each with expected benefit, the people it reaches
// (all holding the diagnosed role), paid minutes per person and in total; exclusions travel with the proposal. The
// recommended option is never the broad course: broad mandatory training happens only when the manager selects it.
// The manager approves the exact payload and chooses the option and the people (a subset of its people); course
// clarifications stay with the course's named reviewer to publish.
import type { Bindings } from '../auth.server'
import { isManager, type Actor } from './actor'
import type { Kind } from './agent-work'
import { insertAssignments } from './assignments'
import { all, commit, insist, newId, now, one, stmt } from './core'
import type { Input } from './input'
import { requireLearnerScope } from './scope'
import { validTimezone, zonedInstant } from './time'

export const OPTION_KINDS = ['clarification', 'practice', 'assessor_session', 'cohort_assignment', 'process_change', 'broad_course'] as const
const ASSIGNING = ['practice', 'assessor_session', 'cohort_assignment', 'broad_course']

export async function recordDiagnosis(env: Bindings, actor: Actor, input: Input) {
  insist(isManager(actor), 'forbidden', 403)
  const id = newId(), fields = { title: input.text('title', { max: 160 }), finding: input.text('finding', { max: 2000 }), jobRole: input.text('jobRole', { max: 120 }), evidence: input.text('evidence', { max: 4000 }) }
  await commit(env, [stmt(env, 'INSERT INTO beam_diagnoses (id, title, finding, job_role, evidence, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, fields.title, fields.finding, fields.jobRole, fields.evidence, actor.id, now())],
    { actor, action: 'diagnosis.record', subject: id, detail: fields })
  return { id }
}

export async function reviewDiagnosis(env: Bindings, actor: Actor, input: Input) {
  insist(actor.owner || actor.roles.has('reviewer'), 'reviewer_required', 403)
  const diagnosis = await one(env, 'SELECT * FROM beam_diagnoses WHERE id = ?', input.text('diagnosis'))
  insist(diagnosis, 'diagnosis_not_found', 404)
  insist(diagnosis.recorded_by !== actor.id, 'own_diagnosis', 403)
  insist(!diagnosis.reviewed_at, 'diagnosis_reviewed', 409)
  await commit(env, [stmt(env, 'UPDATE beam_diagnoses SET reviewed_by = ?, reviewed_at = ? WHERE id = ? AND reviewed_at IS NULL', actor.id, now(), diagnosis.id)], { actor, action: 'diagnosis.review', subject: diagnosis.id })
  return { id: diagnosis.id, reviewed: true }
}

export async function listDiagnoses(env: Bindings, actor: Actor) {
  insist(isManager(actor) || actor.roles.has('reviewer'), 'forbidden', 403)
  return await all(env, 'SELECT id, title, finding, job_role AS jobRole, evidence, recorded_by AS recordedBy, recorded_at AS recordedAt, reviewed_by AS reviewedBy, reviewed_at AS reviewedAt FROM beam_diagnoses ORDER BY recorded_at DESC LIMIT 200')
}

const object = (value: unknown): Record<string, any> => { insist(value && typeof value === 'object' && !Array.isArray(value), 'invalid_payload'); return value as Record<string, any> }
const text = (value: unknown, code: string, max: number) => { insist(typeof value === 'string' && value.trim() && value.trim().length <= max, code); return (value as string).trim() }
const roleMembers = async (env: Bindings, role: string) => (await all(env, "SELECT m.id FROM beam_members m LEFT JOIN oa_operators o ON o.id = m.operator_id WHERE lower(m.job_role) = lower(?) AND m.employment <> 'terminated' AND (o.status IS NULL OR o.status <> 'inactive') ORDER BY m.id", role)).map(row => row.id as string)

export const interventionKind: Kind = {
  label: 'Intervention',
  prepare: ['manager'],
  async validate(env, _actor, value) {
    const payload = object(value)
    const diagnosis = await one(env, 'SELECT id, job_role FROM beam_diagnoses WHERE id = ? AND reviewed_at IS NOT NULL', text(payload.diagnosis, 'invalid_diagnosis', 64))
    insist(diagnosis, 'diagnosis_not_reviewed', 409)
    const role = await roleMembers(env, diagnosis.job_role)
    insist(Array.isArray(payload.options) && payload.options.length >= 2 && payload.options.length <= 6, 'invalid_options')
    const options: Record<string, any>[] = []
    for (const raw of payload.options) {
      const item = object(raw)
      const id = text(item.id, 'invalid_option_id', 40)
      insist(/^[a-z0-9-]+$/.test(id) && !options.some(option => option.id === id), 'invalid_option_id')
      const kind = text(item.kind, 'invalid_option_kind', 40)
      insist((OPTION_KINDS as readonly string[]).includes(kind), 'invalid_option_kind')
      const people = [...new Set(Array.isArray(item.people) ? item.people as string[] : [])]
      insist(people.every(person => role.includes(person)), 'person_outside_diagnosed_role')
      // The broad alternative is the whole diagnosed role; every narrower option names its people.
      if (kind === 'broad_course') insist(people.length === role.length, 'broad_course_is_the_whole_role')
      else if (kind !== 'process_change') insist(people.length >= 1, 'people_required')
      const minutes = item.paidMinutesPerPerson
      insist(Number.isInteger(minutes) && minutes >= 0 && minutes <= 2400, 'invalid_paid_minutes')
      const option: Record<string, unknown> = { id, kind, summary: text(item.summary, 'invalid_summary', 600), expectedBenefit: text(item.expectedBenefit, 'invalid_expected_benefit', 600), roles: [diagnosis.job_role], people, paidMinutesPerPerson: minutes, totalPaidMinutes: minutes * people.length }
      if (ASSIGNING.includes(kind) || kind === 'clarification') {
        const course = await one(env, 'SELECT c.id, c.published_revision_id, s.practical_instructions FROM beam_courses c LEFT JOIN beam_assessment_revisions s ON s.course_revision_id = c.published_revision_id WHERE c.id = ?', text(item.course, 'invalid_course', 64))
        insist(course?.published_revision_id, 'course_not_published', 409)
        insist(course.published_revision_id === text(item.courseRevision, 'invalid_course_revision', 64), 'revision_not_current', 409)
        if (kind === 'assessor_session') insist(course.practical_instructions, 'assessor_session_needs_practical', 409)
        Object.assign(option, { course: course.id, courseRevision: course.published_revision_id })
      }
      if (ASSIGNING.includes(kind)) {
        const due = { dueDate: text(item.dueDate, 'invalid_due_date', 10), dueTime: text(item.dueTime ?? '17:00', 'invalid_due_time', 5), timezone: text(item.timezone, 'invalid_timezone', 64) }
        insist(validTimezone(due.timezone), 'invalid_timezone')
        zonedInstant(due.dueDate, due.dueTime, due.timezone)
        Object.assign(option, due)
      }
      options.push(option)
    }
    insist(options.some(option => option.kind === 'broad_course'), 'broad_alternative_required')
    const recommended = text(payload.recommended, 'invalid_recommended', 40)
    const chosen = options.find(option => option.id === recommended)
    insist(chosen, 'invalid_recommended')
    insist(chosen.kind !== 'broad_course', 'broad_training_not_recommendable')
    return { diagnosis: diagnosis.id, role: diagnosis.job_role, options, recommended }
  },
  async mayDecide(_env, actor) { insist(isManager(actor), 'forbidden', 403) },
  async apply(env, actor, { id, payload }, selection) {
    insist(await one(env, 'SELECT 1 FROM beam_diagnoses WHERE id = ? AND reviewed_at IS NOT NULL', payload.diagnosis), 'proposal_stale', 409)
    const option = payload.options.find((item: any) => item.id === (selection?.text('option', { optional: true, max: 40 }) || payload.recommended))
    insist(option, 'invalid_option')
    const chosen = selection?.list('people') ?? []
    const people: string[] = chosen.length ? [...new Set(chosen)] : option.people
    insist(people.every(person => option.people.includes(person)), 'person_not_in_option')
    for (const person of people) requireLearnerScope(actor, person)
    let assignments: string[] = []
    if (ASSIGNING.includes(option.kind)) {
      const course = await one(env, 'SELECT published_revision_id FROM beam_courses WHERE id = ?', option.course)
      insist(course?.published_revision_id === option.courseRevision, 'proposal_stale', 409)
      assignments = (await insertAssignments(env, actor, people.map(learner => ({ learner, course: option.course, dueDate: option.dueDate, dueTime: option.dueTime, timezone: option.timezone, reason: `intervention ${id}` })), 'assignment.intervention')).created
    }
    const reviewer = option.kind === 'clarification' ? (await one(env, 'SELECT reviewer_id FROM beam_courses WHERE id = ?', option.course))?.reviewer_id ?? null : null
    return { diagnosis: payload.diagnosis, option: option.id, kind: option.kind, people, assignments, totalPaidMinutes: option.paidMinutesPerPerson * people.length, ...(reviewer ? { publishedBy: reviewer } : {}) }
  },
}
