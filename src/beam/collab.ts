// AUTHOR-003: coauthoring a course draft. A lesson conflict (courses.ts saveLesson) keeps both texts until a coauthor
// resolves it: keep the current text, use the conflicting one, or save a merged text; who resolved it and how is kept.
// Everyone who may edit or review the course comments on a draft lesson or question, replies in its thread, and
// resolves the thread; a change request is a thread that asks for a change and stays open until resolved.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import { editDraft, loadCourse, type Lesson } from './courses'
import type { Input } from './input'
import { requireCourseRole } from './units'

const requireCollaborator = (env: Bindings, actor: Actor, course: string) => requireCourseRole(env, actor, course, 'author', 'reviewer')

/** Resolves a lesson conflict against the draft version the resolver saw. */
export async function resolveConflict(env: Bindings, actor: Actor, input: Input) {
  const conflict = await one(env, 'SELECT * FROM beam_draft_conflicts WHERE id = ? AND resolution IS NULL', input.text('conflict'))
  insist(conflict, 'conflict_not_open', 409)
  await requireCourseRole(env, actor, conflict.course_id, 'author')
  const choice = input.text('choice')
  insist(['kept_current', 'used_mine', 'merged'].includes(choice), 'invalid_choice')
  const mine = JSON.parse(conflict.mine_json) as Lesson
  let draftVersion: number
  if (choice === 'kept_current') {
    draftVersion = (await loadCourse(env, conflict.course_id)).draft_version
  } else {
    const replacement: Lesson = choice === 'used_mine' ? mine : { ...mine, title: input.text('title', { max: 160 }), body: input.text('body', { max: 50_000 }) }
    draftVersion = (await editDraft(env, actor, input, 'course.lesson', draft => {
      const index = draft.lessons.findIndex(lesson => lesson.id === conflict.lesson_id)
      insist(index >= 0, 'lesson_not_found', 404)
      draft.lessons[index] = { ...replacement, id: conflict.lesson_id }
    }, { lesson: conflict.lesson_id, conflict: conflict.id })).draftVersion
  }
  await commit(env, [stmt(env, 'UPDATE beam_draft_conflicts SET resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND resolution IS NULL', choice, actor.id, now(), conflict.id)],
    { actor, action: 'course.conflict.resolve', subject: conflict.course_id, detail: { conflict: conflict.id, choice } })
  return { id: conflict.course_id, draftVersion }
}

export async function addComment(env: Bindings, actor: Actor, input: Input) {
  const course = await loadCourse(env, input.text('course'))
  await requireCollaborator(env, actor, course.id)
  const body = input.text('body', { max: 4000 })
  const thread = input.text('thread', { optional: true }) || null
  let target: { kind: string; id: string }, kind = 'comment'
  if (thread) {
    const root = await one(env, 'SELECT * FROM beam_course_comments WHERE id = ? AND course_id = ? AND thread_id IS NULL', thread, course.id)
    insist(root, 'thread_not_found', 404)
    insist(!root.resolved_at, 'thread_resolved', 409)
    target = { kind: root.target_kind, id: root.target_id }
  } else {
    target = { kind: input.text('targetKind'), id: input.text('target') }
    insist(target.kind === 'lesson' ? course.draft.lessons.some(lesson => lesson.id === target.id) : target.kind === 'question' && course.draft.questions.some(question => question.id === target.id), 'comment_target_not_found', 404)
    kind = input.text('kind', { optional: true }) || 'comment'
    insist(kind === 'comment' || kind === 'change', 'invalid_kind')
  }
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_course_comments (id, course_id, target_kind, target_id, thread_id, kind, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, course.id, target.kind, target.id, thread, kind, actor.id, body, now())],
    { actor, action: kind === 'change' ? 'course.change_request' : 'course.comment', subject: course.id, detail: { comment: id, thread, target } })
  return { id }
}

export async function resolveThread(env: Bindings, actor: Actor, input: Input) {
  const root = await one(env, 'SELECT * FROM beam_course_comments WHERE id = ? AND thread_id IS NULL', input.text('thread'))
  insist(root, 'thread_not_found', 404)
  await requireCollaborator(env, actor, root.course_id)
  insist(!root.resolved_at, 'thread_resolved', 409)
  await commit(env, [stmt(env, 'UPDATE beam_course_comments SET resolved_by = ?, resolved_at = ? WHERE id = ? AND resolved_at IS NULL', actor.id, now(), root.id)],
    { actor, action: 'course.thread.resolve', subject: root.course_id, detail: { thread: root.id } })
  return { id: root.id }
}

/** A course's open conflicts and its comment threads, for whoever may edit or review it. */
export async function collaboration(env: Bindings, actor: Actor, course: string) {
  await requireCollaborator(env, actor, course)
  const [conflicts, comments] = await Promise.all([
    all(env, 'SELECT k.id, k.lesson_id AS lesson, k.mine_json AS mine, k.theirs_json AS theirs, k.created_at AS createdAt, a.name AS authorName, k.resolution, r.name AS resolvedByName, k.resolved_at AS resolvedAt FROM beam_draft_conflicts k JOIN beam_members a ON a.id = k.author_id LEFT JOIN beam_members r ON r.id = k.resolved_by WHERE k.course_id = ? ORDER BY k.created_at', course),
    all(env, 'SELECT c.id, c.target_kind AS targetKind, c.target_id AS target, c.thread_id AS thread, c.kind, c.body, c.created_at AS createdAt, a.name AS authorName, c.resolved_at AS resolvedAt, r.name AS resolvedByName FROM beam_course_comments c JOIN beam_members a ON a.id = c.author_id LEFT JOIN beam_members r ON r.id = c.resolved_by WHERE c.course_id = ? ORDER BY c.created_at, c.rowid', course),
  ])
  const threads = comments.filter(comment => !comment.thread).map(root => ({ ...root, replies: comments.filter(comment => comment.thread === root.id) }) as Row)
  return { conflicts: conflicts.map(row => ({ ...row, mine: JSON.parse(row.mine), theirs: JSON.parse(row.theirs) }) as Row), threads }
}
