// LEARN-007 inputs: the owner (acting as admin) proposes skills and maps courses (optionally one of a course's
// AUTHOR-005 objectives) and directory job roles to them; a reviewer other than the proposer reviews each skill, and
// only reviewed skills drive recommendations. A person declares their own goals and may turn off optional
// personalization; the owner or a manager of one of their teams records a diagnostic result (a gap, or met) with a note.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt } from './core'
import { loadCourse } from './courses'
import type { Input } from './input'
import { requireLearnerScope } from './scope'

const reviewedSkills = async (env: Bindings, ids: string[]) => {
  for (const id of ids) insist(await one(env, 'SELECT 1 FROM beam_skills WHERE id = ? AND reviewed_at IS NOT NULL', id), 'skill_not_reviewed', 409)
  return ids
}

export async function createSkill(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const name = input.text('name', { max: 80 }), description = input.text('description', { max: 500 })
  insist(!await one(env, 'SELECT 1 FROM beam_skills WHERE lower(name) = lower(?)', name), 'skill_exists', 409)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_skills (id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)', id, name, description, actor.id, now())], { actor, action: 'skill.create', subject: id, detail: { name, description } })
  return { id }
}

/** A reviewer other than whoever proposed the skill. */
export async function reviewSkill(env: Bindings, actor: Actor, input: Input) {
  insist(actor.roles.has('reviewer'), 'reviewer_required', 403)
  const skill = await one(env, 'SELECT * FROM beam_skills WHERE id = ?', input.text('skill'))
  insist(skill, 'skill_not_found', 404)
  insist(skill.created_by !== actor.id, 'own_skill', 403)
  insist(!skill.reviewed_at, 'skill_reviewed', 409)
  await commit(env, [stmt(env, 'UPDATE beam_skills SET reviewed_by = ?, reviewed_at = ? WHERE id = ? AND reviewed_at IS NULL', actor.id, now(), skill.id)], { actor, action: 'skill.review', subject: skill.id, detail: { name: skill.name } })
  return { id: skill.id, reviewed: true }
}

export async function mapCourse(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const course = await loadCourse(env, input.text('course'))
  const skills = await reviewedSkills(env, [...new Set(input.list('skills'))])
  const objective = input.text('objective', { optional: true, max: 300 }) || null
  if (objective) insist((JSON.parse(course.objectives ?? '[]') as string[]).includes(objective), 'objective_not_on_course')
  await commit(env, [stmt(env, 'DELETE FROM beam_course_skills WHERE course_id = ?', course.id), ...skills.map(skill => stmt(env, 'INSERT INTO beam_course_skills (course_id, skill_id, objective) VALUES (?, ?, ?)', course.id, skill, objective))],
    { actor, action: 'skill.course', subject: course.id, detail: { skills, objective } })
  return { course: course.id, skills }
}

/** A directory job role (ORG-001), matched without regard to case. */
export async function mapRole(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const role = input.text('jobRole', { max: 120 }).toLowerCase()
  const skills = await reviewedSkills(env, [...new Set(input.list('skills'))])
  await commit(env, [stmt(env, 'DELETE FROM beam_role_skills WHERE job_role = ?', role), ...skills.map(skill => stmt(env, 'INSERT INTO beam_role_skills (job_role, skill_id) VALUES (?, ?)', role, skill))],
    { actor, action: 'skill.role', subject: role, detail: { skills } })
  return { jobRole: role, skills }
}

export async function setGoals(env: Bindings, actor: Actor, input: Input) {
  const skills = await reviewedSkills(env, [...new Set(input.list('skills'))])
  insist(skills.length <= 10, 'too_many_goals')
  await commit(env, [stmt(env, 'DELETE FROM beam_skill_goals WHERE member_id = ?', actor.id), ...skills.map(skill => stmt(env, 'INSERT INTO beam_skill_goals (member_id, skill_id, declared_at) VALUES (?, ?, ?)', actor.id, skill, now()))],
    { actor, action: 'skill.goals', subject: actor.id, detail: { skills } })
  return { goals: skills }
}

export async function setPersonalization(env: Bindings, actor: Actor, input: Input) {
  const optedOut = input.text('optedOut') === 'true'
  await commit(env, [stmt(env, 'INSERT INTO beam_personalization (member_id, opted_out, updated_at) VALUES (?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET opted_out = excluded.opted_out, updated_at = excluded.updated_at', actor.id, optedOut ? 1 : 0, now())],
    { actor, action: optedOut ? 'skill.personalization_off' : 'skill.personalization_on', subject: actor.id })
  return { optedOut }
}

export async function recordDiagnostic(env: Bindings, actor: Actor, input: Input) {
  const learner = input.text('learner')
  insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', learner), 'person_not_found', 404)
  insist(actor.owner || actor.roles.has('manager'), 'forbidden', 403)
  requireLearnerScope(actor, learner)
  const [skill] = await reviewedSkills(env, [input.text('skill')])
  const result = input.text('result')
  insist(result === 'gap' || result === 'met', 'invalid_result')
  const note = input.text('note', { max: 1000 }), id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_skill_diagnostics (id, member_id, skill_id, result, note, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, learner, skill, result, note, actor.id, now())],
    { actor, action: 'skill.diagnostic', subject: learner, detail: { skill, result, note } })
  return { id }
}

/** The taxonomy and its mappings, for whoever plans learning. */
export async function skillTaxonomy(env: Bindings) {
  const skills = await all(env, 'SELECT id, name, description, created_by AS createdBy, reviewed_by AS reviewedBy, reviewed_at AS reviewedAt FROM beam_skills ORDER BY name')
  const courses = await all(env, 'SELECT k.course_id AS course, c.title, k.skill_id AS skill, k.objective FROM beam_course_skills k JOIN beam_courses c ON c.id = k.course_id ORDER BY c.title')
  const roles = await all(env, 'SELECT job_role AS jobRole, skill_id AS skill FROM beam_role_skills ORDER BY job_role')
  return { skills, courses, roles }
}
