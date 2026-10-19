// ORG-003: who writes and who reviews one course. The owner, or the learning
// administrator of the course's unit, gives people author access to that course
// alone and replaces its named reviewer with a reason; each replacement is kept
// beside the revisions' own decisions, which are never rewritten. The owner
// allows self-review per course for a one-person learning team.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt } from './core'
import type { Input } from './input'

/** The owner, or a learning administrator of the course's unit, manages its authors and reviewer. */
async function requireCourseAdmin(env: Bindings, actor: Actor, course: string) {
  const row = await one<{ unit_id: string | null; reviewer_id: string }>(env, 'SELECT unit_id, reviewer_id FROM beam_courses WHERE id = ?', course)
  insist(row, 'course_not_found', 404)
  insist(actor.owner || (row.unit_id && actor.adminUnits.includes(row.unit_id)), actor.adminUnits.length ? 'outside_your_units' : 'forbidden', 403)
  return row
}

async function requireMembers(env: Bindings, members: string[]) {
  for (const member of members) insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', member), 'person_not_found', 404)
}

/** Sets the people who may draft this course and submit it for review, beyond holders of the author role. */
export async function setCourseAuthors(env: Bindings, actor: Actor, input: Input) {
  const course = input.text('course')
  await requireCourseAdmin(env, actor, course)
  const members = [...new Set(input.list('members'))]
  await requireMembers(env, members)
  await commit(env, [stmt(env, 'DELETE FROM beam_course_authors WHERE course_id = ?', course), ...members.map(member => stmt(env, 'INSERT INTO beam_course_authors (course_id, member_id, granted_by, granted_at) VALUES (?, ?, ?, ?)', course, member, actor.id, now()))],
    { actor, action: 'course.authors', subject: course, detail: { members } })
  return { id: course, authors: members }
}

/** Hands the course to a new named reviewer, with a reason; earlier decisions keep the reviewer who made them. */
export async function replaceReviewer(env: Bindings, actor: Actor, input: Input) {
  const course = input.text('course')
  const row = await requireCourseAdmin(env, actor, course)
  const reviewer = input.text('reviewer')
  await requireMembers(env, [reviewer])
  insist(reviewer !== row.reviewer_id, 'reviewer_unchanged', 409)
  const reason = input.text('reason', { max: 500 })
  const id = newId()
  await commit(env, [
    stmt(env, 'UPDATE beam_courses SET reviewer_id = ? WHERE id = ?', reviewer, course),
    stmt(env, 'INSERT INTO beam_reviewer_changes (id, course_id, previous_reviewer_id, reviewer_id, reason, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, course, row.reviewer_id, reviewer, reason, actor.id, now()),
  ], { actor, action: 'course.reviewer', subject: course, detail: { change: id, previous: row.reviewer_id, reviewer, reason } })
  return { id: course, reviewer }
}

/** The owner allows, or stops, the person who submitted a revision of this course deciding it themselves. */
export async function setSelfReview(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const course = input.text('course')
  insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id = ?', course), 'course_not_found', 404)
  const allowed = input.flag('allowed')
  await commit(env, [stmt(env, 'UPDATE beam_courses SET self_review = ? WHERE id = ?', allowed ? 1 : 0, course)], { actor, action: 'course.selfreview', subject: course, detail: { allowed } })
  return { id: course, selfReview: allowed }
}

/** The course's scoped authors and every reviewer replacement, oldest first. */
export async function courseAccess(env: Bindings, course: string) {
  const [authors, reviewerChanges] = await Promise.all([
    all(env, 'SELECT a.member_id AS id, m.name FROM beam_course_authors a JOIN beam_members m ON m.id = a.member_id WHERE a.course_id = ? ORDER BY m.name', course),
    all(env, 'SELECT id, previous_reviewer_id AS previousReviewer, reviewer_id AS reviewer, reason, changed_by AS changedBy, changed_at AS changedAt FROM beam_reviewer_changes WHERE course_id = ? ORDER BY changed_at, rowid', course),
  ])
  return { authors, reviewerChanges }
}
