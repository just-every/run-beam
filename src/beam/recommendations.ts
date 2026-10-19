// LEARN-007: transparent recommendations. A person's needed skills are the reviewed skills their directory job role
// maps to, then their declared goals (each by name) unless they turned optional personalization off. Only a recorded diagnostic marks
// a skill met; completing a course is shown as evidence of activity and never as competence. Each still-needed skill
// with no open assignment covering it is covered by the fewest published courses mapped to it (greedy cover, then
// title order), skipping courses the person already completed; each item names the inputs behind it. The owner or a
// manager of one of the person's teams approves that exact minimal path (bound by its digest), which assigns it as
// required learning; turning personalization off later removes goal suggestions but never assignments.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { assignCourse } from './assignments'
import { all, commit, insist, newId, now, one, sha256Hex, stmt, type Row } from './core'
import { Input } from './input'
import { requireLearnerScope } from './scope'

export const NOTE = 'Only a recorded diagnostic marks a skill met. Completing a course is learning activity, never proof of a skill.'

export async function recommendations(env: Bindings, actor: Actor, learner: string) {
  if (actor.id !== learner) {
    insist(actor.owner || actor.roles.has('manager'), 'not_found', 404)
    requireLearnerScope(actor, learner)
  }
  const person = await one(env, 'SELECT id, name, job_role FROM beam_members WHERE id = ?', learner)
  insist(person, 'not_found', 404)
  const optedOut = (await one(env, 'SELECT opted_out FROM beam_personalization WHERE member_id = ?', learner))?.opted_out === 1
  const role = (person.job_role ?? '').trim().toLowerCase()
  const reviewed = new Map((await all(env, 'SELECT id, name FROM beam_skills WHERE reviewed_at IS NOT NULL')).map(row => [row.id as string, row.name as string]))
  const roleSkills = role ? (await all(env, 'SELECT k.skill_id FROM beam_role_skills k JOIN beam_skills s ON s.id = k.skill_id WHERE k.job_role = ? ORDER BY s.name', role)).map(row => row.skill_id as string).filter(id => reviewed.has(id)) : []
  const goals = optedOut ? [] : (await all(env, 'SELECT g.skill_id FROM beam_skill_goals g JOIN beam_skills s ON s.id = g.skill_id WHERE g.member_id = ? ORDER BY s.name', learner)).map(row => row.skill_id as string).filter(id => reviewed.has(id))
  const diagnostics = new Map((await all(env, `SELECT d.skill_id, d.result, d.note, d.recorded_at AS recordedAt, m.name AS recordedBy FROM beam_skill_diagnostics d JOIN beam_members m ON m.id = d.recorded_by
    WHERE d.member_id = ? ORDER BY d.recorded_at, d.rowid`, learner)).map(row => [row.skill_id as string, row]))
  const mapped = await all(env, `SELECT k.skill_id AS skill, c.id AS course, c.title, k.objective FROM beam_course_skills k JOIN beam_courses c ON c.id = k.course_id JOIN beam_skills s ON s.id = k.skill_id
    WHERE c.published_revision_id IS NOT NULL AND c.retired_at IS NULL ORDER BY c.title, c.id, s.name`)
  const open = new Set((await all(env, "SELECT course_id FROM beam_assignments WHERE learner_id = ? AND status = 'open'", learner)).map(row => row.course_id as string))
  const completed = new Map((await all(env, 'SELECT course_id, method, MAX(completed_at) AS completedAt FROM beam_completions WHERE learner_id = ? GROUP BY course_id', learner)).map(row => [row.course_id as string, row]))
  const skills: Row[] = []
  for (const id of [...new Set([...roleSkills, ...goals])]) {
    const diagnostic = diagnostics.get(id) ?? null
    const because = [...(roleSkills.includes(id) ? [{ input: 'role', jobRole: person.job_role }] : []), ...(goals.includes(id) ? [{ input: 'goal' }] : []),
      ...(diagnostic ? [{ input: 'diagnostic', result: diagnostic.result, note: diagnostic.note, recordedAt: diagnostic.recordedAt, recordedBy: diagnostic.recordedBy }] : [])]
    const courses = mapped.filter(row => row.skill === id)
    const evidence = courses.filter(row => completed.has(row.course)).map(row => ({ course: row.course, title: row.title, method: completed.get(row.course)!.method, completedAt: completed.get(row.course)!.completedAt }))
    const assigned = courses.filter(row => open.has(row.course)).map(row => row.course)
    const status = diagnostic?.result === 'met' ? 'met' : assigned.length ? 'assigned' : courses.some(row => !completed.has(row.course)) ? 'needed' : 'no_course'
    skills.push({ id, name: reviewed.get(id), required: roleSkills.includes(id), because, status, evidence, assigned })
  }
  // The fewest courses that cover every needed skill.
  const uncovered = new Set(skills.filter(skill => skill.status === 'needed').map(skill => skill.id as string))
  const path: Row[] = []
  while (uncovered.size) {
    const options = [...new Set(mapped.filter(row => uncovered.has(row.skill) && !completed.has(row.course) && !open.has(row.course)).map(row => row.course as string))]
      .map(course => ({ course, covers: mapped.filter(row => row.course === course && uncovered.has(row.skill)), title: mapped.find(row => row.course === course)!.title as string }))
      .sort((a, b) => b.covers.length - a.covers.length || a.title.localeCompare(b.title))
    const best = options[0]
    for (const row of best.covers) uncovered.delete(row.skill)
    path.push({ course: best.course, title: best.title, skills: best.covers.map(row => ({ id: row.skill, name: reviewed.get(row.skill), objective: row.objective, because: skills.find(skill => skill.id === row.skill)!.because })) })
  }
  const digest = await sha256Hex(new TextEncoder().encode(JSON.stringify({ learner, path: path.map(item => [item.course, item.skills.map((skill: Row) => [skill.id, skill.because])]) })))
  return { learner, name: person.name, jobRole: person.job_role ?? null, optedOut, goals, skills, path, digest, note: NOTE }
}

export async function approvePath(env: Bindings, actor: Actor, input: Input) {
  const learner = input.text('learner')
  insist(actor.owner || (actor.roles.has('manager') && actor.id !== learner), 'forbidden', 403)
  const current = await recommendations(env, actor, learner)
  insist(input.text('digest') === current.digest, 'recommendation_changed', 409)
  insist(current.path.length, 'nothing_to_approve', 409)
  const due = { dueDate: input.text('dueDate'), dueTime: input.text('dueTime', { optional: true }) || '17:00', timezone: input.text('timezone', { optional: true }) }
  const created: string[] = []
  for (const item of current.path) created.push(...(await assignCourse(env, actor, Input.of({ course: item.course, learners: [learner], ...due }))).created)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_skill_paths (id, member_id, courses_json, inputs_json, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?)', id, learner, JSON.stringify(current.path.map(item => item.course)), JSON.stringify({ skills: current.skills, digest: current.digest }), actor.id, now())],
    { actor, action: 'skill.path.approve', subject: learner, detail: { path: id, courses: current.path.map(item => item.course), digest: current.digest, assignments: created } })
  return { id, assignments: created }
}

export async function approvedPaths(env: Bindings, learner: string) {
  return (await all(env, 'SELECT p.id, p.courses_json, p.approved_at AS approvedAt, m.name AS approvedBy FROM beam_skill_paths p JOIN beam_members m ON m.id = p.approved_by WHERE p.member_id = ? ORDER BY p.approved_at DESC', learner))
    .map(row => ({ id: row.id, courses: JSON.parse(row.courses_json), approvedAt: row.approvedAt, approvedBy: row.approvedBy }))
}
