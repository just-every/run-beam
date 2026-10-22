// Reviewed five-day delivery, separate from the canonical required assessment. No provider send is simulated.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { editDraft, loadCourse, revisionDetail, type Lesson } from './courses'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { tryComplete, loadAssignment, prerequisiteMet } from './learning'
import { requireAccess } from './access'
import { addDays, localDate, zonedInstant } from './time'
export interface SequenceDay { lesson: string; prompt: string; choices: { label: string; feedback: string; next: 'retry' | 'continue' }[] }
export interface Sequence { workStart: number; workEnd: number; workDays?: number[]; days: SequenceDay[] }
export function normaliseSequence(value: unknown, lessons: Lesson[]): Sequence | undefined {
  if (value === undefined || value === null) return undefined
  const program = value as Sequence
  insist(Number.isInteger(program.workStart) && Number.isInteger(program.workEnd) && program.workStart >= 0 && program.workEnd <= 24 && program.workStart < program.workEnd, 'invalid_sequence_work_window', 422)
  insist(Array.isArray(program.days) && program.days.length === 5, 'sequence_needs_five_days', 422)
  const workDays = program.workDays ?? [1, 2, 3, 4, 5]
  insist(Array.isArray(workDays) && workDays.length >= 1 && workDays.length <= 7 && workDays.every(day => Number.isInteger(day) && day >= 0 && day <= 6) && new Set(workDays).size === workDays.length, 'invalid_sequence_work_days', 422)
  const used = new Set<string>()
  const days = program.days.map(day => {
    insist(day && typeof day === 'object', 'invalid_sequence_day', 422)
    const lesson = lessons.find(l => l.id === day.lesson)
    insist(lesson && lesson.sources.length > 0 && !used.has(lesson.id) && lesson.body.length <= 2000, 'sequence_needs_distinct_short_cited_lessons', 422)
    used.add(lesson.id)
    insist(typeof day.prompt === 'string' && day.prompt.trim() && day.prompt.length <= 500 && Array.isArray(day.choices) && day.choices.length >= 2 && day.choices.length <= 4, 'invalid_sequence_question', 422)
    const choices = day.choices.map(choice => {
      insist(choice && typeof choice === 'object' && typeof choice.label === 'string' && choice.label.trim() && choice.label.length <= 160 && typeof choice.feedback === 'string' && choice.feedback.trim() && choice.feedback.length <= 1000 && ['retry', 'continue'].includes(choice.next), 'invalid_sequence_branch', 422)
      return { label: choice.label.trim(), feedback: choice.feedback.trim(), next: choice.next }
    })
    insist(choices.some(c => c.next === 'continue') && choices.some(c => c.next === 'retry') && new Set(choices.map(c => c.label)).size === choices.length, 'sequence_branch_required', 422)
    return { lesson: lesson!.id, prompt: day.prompt.trim(), choices }
  })
  return { workStart: program.workStart, workEnd: program.workEnd, workDays, days }
}
export async function saveSequence(env: Bindings, actor: Actor, input: Input) {
  return editDraft(env, actor, input, 'course.sequence', draft => {
    if (input.flag('remove')) { delete draft.sequence; return }
    draft.sequence = input.has('sequence') ? input.json('sequence') as Sequence : { workStart: input.integer('workStart', { min: 0, max: 23 })!, workEnd: input.integer('workEnd', { min: 1, max: 24 })!, workDays: input.list('workDays').map(Number), days: Array.from({ length: 5 }, (_, index) => { const day = index + 1; return { lesson: input.text(`lesson${day}`), prompt: input.text(`prompt${day}`, { max: 500 }), choices: [1, 2].map(choice => ({ label: input.text(`choice${day}_${choice}`, { max: 160 }), feedback: input.text(`feedback${day}_${choice}`, { max: 1000 }), next: input.text(`next${day}_${choice}`) as 'retry' | 'continue' })) } }) }
  })
}
export async function revisionSequence(env: Bindings, revision: string): Promise<Sequence | null> {
  const row = await one(env, 'SELECT sequence_json FROM beam_revision_sequences WHERE course_revision_id=?', revision)
  return row ? JSON.parse(row.sequence_json) : null
}
const workday = (date: string, program: Sequence) => (program.workDays ?? [1, 2, 3, 4, 5]).includes(new Date(`${date}T12:00:00Z`).getUTCDay())
const hour = (n: number) => `${String(n).padStart(2, '0')}:00`
/** Calendar-day spacing in the assignment zone, skipping weekends and preserving DST wall-clock work hours. */
export function sequenceSchedule(program: Sequence, assignment: Row, pausedMs: number) {
  const zone = assignment.timezone, started = assignment.assigned_at + pausedMs
  let date = localDate(started, zone)
  const close = (d: string) => program.workEnd === 24 ? zonedInstant(addDays(d, 1), '00:00', zone) : zonedInstant(d, hour(program.workEnd), zone)
  if (started >= close(date)) date = addDays(date, 1)
  while (!workday(date, program)) date = addDays(date, 1)
  return program.days.map((_, index) => {
    if (index) { date = addDays(date, 1); while (!workday(date, program)) date = addDays(date, 1) }
    return { day: index + 1, opensAt: index === 0 ? Math.max(started, zonedInstant(date, hour(program.workStart), zone)) : zonedInstant(date, hour(program.workStart), zone), closesAt: close(date), date }
  })
}
export async function sequenceView(env: Bindings, actor: Actor, assignmentId: string) {
  const assignment = await loadAssignment(env, actor, assignmentId, { manage: true })
  requireAccess(assignment); insist(await prerequisiteMet(env, assignment), 'prerequisite_incomplete', 409)
  const program = await revisionSequence(env, assignment.course_revision_id)
  if (!program) return null
  const state = await one(env, 'SELECT * FROM beam_sequence_state WHERE assignment_id=?', assignment.id)
  const answers = await all(env, 'SELECT * FROM beam_sequence_answers WHERE assignment_id=? ORDER BY answered_at,rowid', assignment.id)
  const advanced = new Set(answers.filter(a => a.next === 'continue').map(a => a.day as number))
  const day = program.days.findIndex((_, index) => !advanced.has(index + 1)) + 1
  const at = now(), paused = !!state?.paused_at, schedule = sequenceSchedule(program, assignment, (state?.paused_ms ?? 0) + (paused ? at - state!.paused_at : 0))
  const local = localDate(at, assignment.timezone), start = zonedInstant(local, hour(program.workStart), assignment.timezone)
  const end = program.workEnd === 24 ? zonedInstant(addDays(local, 1), '00:00', assignment.timezone) : zonedInstant(local, hour(program.workEnd), assignment.timezone)
  const available = day > 0 && !paused && workday(local, program) && at >= start && at < end && at >= schedule[day - 1].opensAt
  const content = await revisionDetail(env, assignment.course_revision_id)
  return { assignment, revision: assignment.course_revision_id as string, program, schedule, day, available, paused, version: state?.version ?? 0, advanced: [...advanced], lessons: content.lessons, assessmentRequired: !!content.assessment && (content.assessment.questions.length > 0 || !!content.assessment.practical_instructions), answers: actor.id === assignment.learner_id || actor.owner ? answers : [] }
}
export async function sequenceAnswer(env: Bindings, actor: Actor, input: Input) {
  insist(!actor.agent && !actor.viewAs, 'human_session_required', 403)
  const view = await sequenceView(env, actor, input.text('assignment'))
  insist(view && view.assignment.learner_id === actor.id, 'not_found', 404)
  requireAccess(view.assignment)
  insist(view.assignment.status === 'open' && await prerequisiteMet(env, view.assignment), 'sequence_assignment_unavailable', 403)
  const day = input.integer('day', { min: 1, max: 5 })!, choice = input.integer('choice', { min: 0, max: 3 })!
  insist(view.available && day === view.day, view.paused ? 'sequence_paused' : 'sequence_not_due', 409)
  insist(view.version === input.integer('version', { min: 0 }), 'stale_sequence', 409)
  const selected = view.program.days[day - 1].choices[choice]; insist(selected, 'sequence_choice_not_found', 422)
  await env.DB.prepare('INSERT OR IGNORE INTO beam_sequence_state(assignment_id) VALUES(?)').bind(view.assignment.id).run()
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_sequence_answers SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM beam_sequence_state WHERE assignment_id=? AND version=? AND paused_at IS NULL)', id, view.assignment.id, view.revision, day, choice, selected.next, selected.feedback, now(), view.assignment.id, view.version), ...(selected.next === 'continue' ? [stmt(env, 'INSERT OR IGNORE INTO beam_lesson_progress SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM beam_sequence_answers WHERE id=?)', view.assignment.id, view.program.days[day - 1].lesson, now(), id)] : []), stmt(env, 'UPDATE beam_sequence_state SET version=version+1 WHERE assignment_id=? AND version=? AND paused_at IS NULL', view.assignment.id, view.version)], { actor, action: 'sequence.answer', subject: view.assignment.id, detail: { day, choice, revision: view.revision } })
  insist(await one(env, 'SELECT 1 FROM beam_sequence_answers WHERE id=?', id), 'stale_sequence', 409)
  if (selected.next === 'continue') await tryComplete(env, actor, view.assignment.id)
  return { id, revision: view.revision, feedback: selected.feedback, next: selected.next, assessmentRequired: view.assessmentRequired }
}
export async function sequencePause(env: Bindings, actor: Actor, input: Input) {
  insist(!actor.agent && !actor.viewAs, 'human_session_required', 403)
  const view = await sequenceView(env, actor, input.text('assignment'))
  insist(view && view.assignment.learner_id === actor.id, 'not_found', 404)
  requireAccess(view.assignment); insist(view.assignment.status === 'open', 'assignment_closed', 409)
  const pause = input.flag('pause'), version = input.integer('version', { min: 0 })!
  insist(view.version === version && view.paused !== pause, 'stale_sequence', 409)
  await env.DB.prepare('INSERT OR IGNORE INTO beam_sequence_state(assignment_id) VALUES(?)').bind(view.assignment.id).run()
  const result = await env.DB.batch([
    stmt(env, 'UPDATE beam_sequence_state SET paused_at=?,paused_ms=paused_ms+?,version=version+1 WHERE assignment_id=? AND version=?', pause ? now() : null, pause ? 0 : now() - (await one(env, 'SELECT paused_at FROM beam_sequence_state WHERE assignment_id=?', view.assignment.id))!.paused_at, view.assignment.id, version),
    stmt(env, 'INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,?,?,? WHERE changes()=1', now(), actor.id, pause ? 'sequence.pause' : 'sequence.resume', view.assignment.id, JSON.stringify({ revision: view.revision })),
  ])
  insist(result[0].meta.changes === 1, 'stale_sequence', 409)
  return { paused: pause, version: version + 1 }
}
export async function sequencePreview(env: Bindings, actor: Actor, courseId: string, revision?: string) {
  const { requireCourseRole } = await import('./units')
  await requireCourseRole(env, actor, courseId, 'author', 'reviewer')
  if (revision) { const content = await revisionDetail(env, revision); insist(content.revision.course_id === courseId, 'not_found', 404); return { title: content.revision.title, revision, program: await revisionSequence(env, revision), lessons: content.lessons, assessmentRequired: !!content.assessment && (content.assessment.questions.length > 0 || !!content.assessment.practical_instructions) } }
  const course = await loadCourse(env, courseId)
  return { title: course.draft.title, revision: `draft-${course.draft_version}`, program: course.draft.sequence ?? null, lessons: course.draft.lessons, assessmentRequired: course.draft.questions.length > 0 || !!course.draft.practical }
}
export function sequenceMessage(program: Sequence, lessons: Lesson[], day: number, revision: string, assessmentRequired: boolean, href: string) {
  const step = program.days[day - 1], lesson = lessons.find(l => l.id === step.lesson)!
  const text = `Day ${day}/5: ${lesson.title}\n${lesson.body}\n${(lesson.blocks ?? []).map(block => `[${block.kind} media: continue on the secure web page]`).join('\n')}\n${step.prompt}\n${step.choices.map((choice, index) => `${index + 1}. ${choice.label}`).join('\n')}\nRevision: ${revision}\nSources: ${lesson.sources.join(', ')}\n${assessmentRequired ? 'Required assessment remains on the web course.' : 'This formative check does not certify competence.'}\n${href}`
  return { revision, assessmentRequired, sources: lesson.sources, sms: text, teams: { type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', text, wrap: true }], actions: [{ type: 'Action.OpenUrl', title: 'Continue securely on web', url: href }] } }
}
