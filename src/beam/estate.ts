// AUTHOR-005, first slice: retiring and cloning courses. Whoever manages a course's catalog (the owner, the learning
// administrator of its unit, or a custom role with the courses permission there) retires it with a reason, reinstates
// it, or clones it. Retirement stops every new assignment of the course (assignments.ts refuses it, so individual,
// team, path and renewal assignments all stop) while its revisions, open assignments, completions and certificates
// stay readable and open assignments can still be finished. A clone is a new, unpublished course whose draft copies
// the source's current draft, in the same unit with the same named reviewer; nothing else is shared.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { commit, insist, newId, now, stmt } from './core'
import { loadCourse } from './courses'
import type { Input } from './input'
import { requireCourseRole } from './units'

export async function retireCourse(env: Bindings, actor: Actor, input: Input) {
  const course = await loadCourse(env, input.text('course'))
  await requireCourseRole(env, actor, course.id)
  insist(!course.retired_at, 'course_retired', 409)
  const reason = input.text('reason', { max: 500 })
  await commit(env, [stmt(env, 'UPDATE beam_courses SET retired_at = ?, retired_by = ?, retire_reason = ? WHERE id = ? AND retired_at IS NULL', now(), actor.id, reason, course.id)],
    { actor, action: 'course.retire', subject: course.id, detail: { reason } })
  return { id: course.id, retired: true }
}

export async function reinstateCourse(env: Bindings, actor: Actor, input: Input) {
  const course = await loadCourse(env, input.text('course'))
  await requireCourseRole(env, actor, course.id)
  insist(course.retired_at, 'course_not_retired', 409)
  await commit(env, [stmt(env, 'UPDATE beam_courses SET retired_at = NULL, retired_by = NULL, retire_reason = NULL WHERE id = ?', course.id)],
    { actor, action: 'course.reinstate', subject: course.id, detail: { retiredAt: course.retired_at, reason: course.retire_reason } })
  return { id: course.id, retired: false }
}

export async function cloneCourse(env: Bindings, actor: Actor, input: Input) {
  const source = await loadCourse(env, input.text('course'))
  await requireCourseRole(env, actor, source.id)
  const title = input.text('title', { optional: true, max: 160 }) || `Copy of ${source.title}`.slice(0, 160)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_courses (id, title, reviewer_id, created_by, created_at, draft_json, draft_version, unit_id, cloned_from) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    id, title, source.reviewer_id, actor.id, now(), JSON.stringify({ ...source.draft, title }), source.unit_id ?? null, source.id)],
    { actor, action: 'course.clone', subject: id, detail: { from: source.id, draftVersion: source.draft_version, title } })
  return { id, draftVersion: 1, clonedFrom: source.id }
}
