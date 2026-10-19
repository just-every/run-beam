// AUTHOR-005: organising the course estate. Catalog details (folder, tags, learning objectives, language, expected
// duration, owner, template mark) describe a course outside its reviewed revisions; tags change on many courses at
// once; a retired course can be archived out of the everyday list. Retiring and cloning: Whoever manages a course's catalog (the owner, the learning
// administrator of its unit, or a custom role with the courses permission there) retires it with a reason, reinstates
// it, or clones it. Retirement stops every new assignment of the course (assignments.ts refuses it, so individual,
// team, path and renewal assignments all stop) while its revisions, open assignments, completions and certificates
// stay readable and open assignments can still be finished. A clone is a new, unpublished course whose draft copies
// the source's current draft, in the same unit with the same named reviewer; nothing else is shared.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { commit, insist, newId, now, one, stmt } from './core'
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
  await commit(env, [stmt(env, 'UPDATE beam_courses SET retired_at = NULL, retired_by = NULL, retire_reason = NULL, archived_at = NULL WHERE id = ?', course.id)],
    { actor, action: 'course.reinstate', subject: course.id, detail: { retiredAt: course.retired_at, reason: course.retire_reason } })
  return { id: course.id, retired: false }
}

/** Copies a course; any author may start from a course marked as a template. The copy keeps the catalog details
 * except the owner (whoever copies it) and the template mark. */
export async function cloneCourse(env: Bindings, actor: Actor, input: Input) {
  const source = await loadCourse(env, input.text('course'))
  await requireCourseRole(env, actor, source.id, ...(source.is_template ? ['author' as const] : []))
  const title = input.text('title', { optional: true, max: 160 }) || `Copy of ${source.title}`.slice(0, 160)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_courses (id, title, reviewer_id, created_by, created_at, draft_json, draft_version, unit_id, cloned_from, folder, tags, objectives, language, duration_minutes, owner_id) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, title, source.reviewer_id, actor.id, now(), JSON.stringify({ ...source.draft, title }), source.unit_id ?? null, source.id, source.folder ?? null, source.tags, source.objectives, source.language, source.duration_minutes ?? null, actor.id)],
    { actor, action: 'course.clone', subject: id, detail: { from: source.id, draftVersion: source.draft_version, title } })
  return { id, draftVersion: 1, clonedFrom: source.id }
}

const tagList = (value: string) => [...new Set(value.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean))]
const LANGUAGE = /^[a-z]{2,3}(-[A-Z]{2})?$/

/** Sets a course's catalog details. Tags are lowercased and deduplicated; the language is a BCP 47 code such as en
 * or es-US; duration is whole minutes. */
export async function setCatalog(env: Bindings, actor: Actor, input: Input) {
  const course = await loadCourse(env, input.text('course'))
  await requireCourseRole(env, actor, course.id)
  const folder = input.text('folder', { optional: true, max: 80 }) || null
  const tags = tagList(input.text('tags', { optional: true, max: 1000 }))
  insist(tags.length <= 20 && tags.every(tag => tag.length <= 40), 'invalid_tags')
  const objectives = input.text('objectives', { optional: true, max: 3000 }).split('\n').map(line => line.trim()).filter(Boolean)
  insist(objectives.length <= 10 && objectives.every(line => line.length <= 300), 'invalid_objectives')
  const language = input.text('language', { optional: true, max: 10 }) || 'en'
  insist(LANGUAGE.test(language), 'invalid_language')
  const duration = input.integer('durationMinutes', { min: 1, max: 10_000, optional: true })
  const owner = input.text('owner', { optional: true }) || null
  if (owner) insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', owner), 'person_not_found', 404)
  const template = input.has('template') && input.text('template') !== 'false'
  const detail = { folder, tags, objectives, language, durationMinutes: duration, owner, template }
  await commit(env, [stmt(env, 'UPDATE beam_courses SET folder = ?, tags = ?, objectives = ?, language = ?, duration_minutes = ?, owner_id = ?, is_template = ? WHERE id = ?', folder, JSON.stringify(tags), JSON.stringify(objectives), language, duration, owner, template ? 1 : 0, course.id)],
    { actor, action: 'course.catalog', subject: course.id, detail })
  return { id: course.id, ...detail }
}

/** Adds and removes tags on several courses at once; every course must be one this person manages, or nothing changes. */
export async function retagCourses(env: Bindings, actor: Actor, input: Input) {
  const ids = [...new Set(input.list('courses'))]
  insist(ids.length >= 1 && ids.length <= 200, 'courses_required')
  const add = tagList(input.text('add', { optional: true, max: 1000 })), remove = tagList(input.text('remove', { optional: true, max: 1000 }))
  insist(add.length || remove.length, 'tags_required')
  const courses = []
  for (const id of ids) {
    const course = await loadCourse(env, id)
    await requireCourseRole(env, actor, course.id)
    const tags = [...new Set([...(JSON.parse(course.tags) as string[]).filter(tag => !remove.includes(tag)), ...add])]
    insist(tags.length <= 20 && tags.every(tag => tag.length <= 40), 'invalid_tags')
    courses.push({ id: course.id, tags })
  }
  await commit(env, courses.map(course => stmt(env, 'UPDATE beam_courses SET tags = ? WHERE id = ?', JSON.stringify(course.tags), course.id)),
    { actor, action: 'course.retag', subject: ids.join(','), detail: { add, remove, courses } })
  return { courses }
}

/** Files a retired course out of the everyday list, or back into it; an archived course stays readable and retired. */
export async function archiveCourse(env: Bindings, actor: Actor, input: Input) {
  const course = await loadCourse(env, input.text('course'))
  await requireCourseRole(env, actor, course.id)
  const archived = input.text('archived', { optional: true }) !== 'false'
  insist(!archived || course.retired_at, 'retire_before_archiving', 409)
  await commit(env, [stmt(env, 'UPDATE beam_courses SET archived_at = ? WHERE id = ?', archived ? now() : null, course.id)],
    { actor, action: archived ? 'course.archive' : 'course.unarchive', subject: course.id, detail: {} })
  return { id: course.id, archived }
}
