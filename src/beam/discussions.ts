// LEARN-014: lesson discussions and expert questions for a course's cohort. A course's cohort is everyone with an
// assignment on it that was not cancelled; its experts are its named reviewer and its course authors (ORG-003); its
// moderators are the experts, the learning administrators of its unit and the owner. Only these read or post; anyone
// else gets not-found, a learner of another course included. A question is named, posted under a lesson of a
// published revision; an expert answers, resolves it with the answer and may turn it into a course-draft proposal that
// cites source versions (the reviewer decides; nothing publishes). Attachments are inert stored bytes: a learner's stays
// pending for everyone else until an expert or moderator approves it, and a removed one is never served. Moderators
// hide a post with a reason; it stays in the record for them. Posts never touch attempts, completions or certificates.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { BeamError, all, commit, insist, newId, now, one, stmt, type Row } from './core'
import { loadCourse } from './courses'
import { serve, store } from './files'
import type { Input } from './input'
import { createProposal } from './maintenance'
import { courseInUnits } from './units'

const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
const MAX_FILE = 10_000_000

export interface Standing { reader: boolean; expert: boolean; moderator: boolean }

/** What this person may do in a course's discussions. */
export async function standing(env: Bindings, actor: Actor, course: string): Promise<Standing> {
  const row = await one(env, `SELECT c.reviewer_id = ?1 AS reviewer, EXISTS (SELECT 1 FROM beam_course_authors x WHERE x.course_id = c.id AND x.member_id = ?1) AS author,
    EXISTS (SELECT 1 FROM beam_assignments a WHERE a.course_id = c.id AND a.learner_id = ?1 AND a.status <> 'cancelled') AS enrolled FROM beam_courses c WHERE c.id = ?2`, actor.id, course)
  if (!row) return { reader: false, expert: false, moderator: false }
  const expert = actor.owner || !!row.reviewer || !!row.author
  const moderator = expert || await courseInUnits(env, actor, course)
  return { reader: moderator || !!row.enrolled, expert, moderator }
}

async function requireReader(env: Bindings, actor: Actor, course: string) {
  const mine = await standing(env, actor, course)
  if (!mine.reader) throw new BeamError('not_found', 404)
  return mine
}

async function loadThread(env: Bindings, actor: Actor, id: string) {
  const thread = await one(env, 'SELECT * FROM beam_discussion_threads WHERE id = ?', id)
  if (!thread) throw new BeamError('not_found', 404)
  return { thread, standing: await requireReader(env, actor, thread.course_id) }
}

/** A post with its optional attachment; an expert's or moderator's attachment is approved as it is shared. */
async function postStatements(env: Bindings, actor: Actor, input: Input, thread: string, mine: Standing) {
  const body = input.text('body', { max: 4000 }), post = newId(), at = now()
  const statements = [stmt(env, 'INSERT INTO beam_discussion_posts (id, thread_id, author_id, expert, body, created_at) VALUES (?, ?, ?, ?, ?, ?)', post, thread, actor.id, mine.expert ? 1 : 0, body, at)]
  const file = await input.file('file', { optional: true, maxBytes: MAX_FILE })
  let attachment: Row | null = null
  if (file) {
    const stored = await store(env, file)
    insist(FILE_TYPES.includes(stored.mediaType), 'discussion_file_type')
    const id = newId(), fileId = newId(), approved = mine.expert || mine.moderator
    statements.push(
      stmt(env, 'INSERT INTO beam_attachments (id, filename, media_type, size, sha256, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, stored.filename, stored.mediaType, stored.size, stored.sha256, actor.id, at),
      stmt(env, 'INSERT INTO beam_discussion_files (id, post_id, attachment_id, state, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?)', fileId, post, id, approved ? 'approved' : 'pending', approved ? actor.id : null, approved ? at : null),
    )
    attachment = { id: fileId, state: approved ? 'approved' : 'pending', sha256: stored.sha256 }
  }
  return { post, statements, attachment }
}

/** An enrolled learner (or an expert) asks a question or opens a discussion under a lesson of a published revision. */
export async function askQuestion(env: Bindings, actor: Actor, input: Input) {
  const course = input.text('course', { max: 64 })
  const mine = await requireReader(env, actor, course)
  const lesson = await one(env, 'SELECT l.id FROM beam_lesson_revisions l JOIN beam_course_revisions r ON r.id = l.course_revision_id WHERE l.id = ? AND r.course_id = ?', input.text('lesson', { max: 64 }), course)
  insist(lesson, 'lesson_not_found', 404)
  const kind = input.text('kind', { optional: true, max: 12 }) || 'question'
  insist(kind === 'question' || kind === 'discussion', 'invalid_kind')
  const id = newId(), title = input.text('title', { max: 200 })
  const { post, statements, attachment } = await postStatements(env, actor, input, id, mine)
  await commit(env, [stmt(env, "INSERT INTO beam_discussion_threads (id, course_id, lesson_revision_id, kind, title, state, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)", id, course, lesson.id, kind, title, actor.id, now()), ...statements],
    { actor, action: 'discussion.ask', subject: id, detail: { course, lesson: lesson.id, kind, post, attachment } })
  return { id, post, attachment }
}

export async function reply(env: Bindings, actor: Actor, input: Input) {
  const { thread, standing: mine } = await loadThread(env, actor, input.text('thread', { max: 64 }))
  const { post, statements, attachment } = await postStatements(env, actor, input, thread.id, mine)
  await commit(env, statements, { actor, action: 'discussion.reply', subject: thread.id, detail: { post, expert: mine.expert, attachment } })
  return { id: thread.id, post, expert: mine.expert, attachment }
}

/** An expert resolves a question with one visible post of the thread as its answer. */
export async function resolveQuestion(env: Bindings, actor: Actor, input: Input) {
  const { thread, standing: mine } = await loadThread(env, actor, input.text('thread', { max: 64 }))
  insist(mine.expert, 'experts_only', 403)
  const answer = await one(env, 'SELECT id FROM beam_discussion_posts WHERE id = ? AND thread_id = ? AND hidden_at IS NULL', input.text('answer', { max: 64 }), thread.id)
  insist(answer, 'answer_not_found', 404)
  await commit(env, [stmt(env, "UPDATE beam_discussion_threads SET state = 'resolved', answer_post_id = ?, resolved_by = ?, resolved_at = ? WHERE id = ?", answer.id, actor.id, now(), thread.id)],
    { actor, action: 'discussion.resolve', subject: thread.id, detail: { answer: answer.id } })
  return { id: thread.id, answer: answer.id }
}

/** An expert turns a resolved question into a proposed update of one draft lesson, citing that lesson's source
 * versions; the course's reviewer accepts or declines it like any other proposal. */
export async function proposeFromThread(env: Bindings, actor: Actor, input: Input) {
  const { thread, standing: mine } = await loadThread(env, actor, input.text('thread', { max: 64 }))
  insist(mine.expert, 'experts_only', 403)
  insist(thread.state === 'resolved', 'question_not_resolved', 409)
  insist(!thread.proposal_id, 'already_proposed', 409)
  const course = await loadCourse(env, thread.course_id)
  const lessonId = input.text('draftLesson', { max: 64 }), body = input.text('lessonBody', { max: 20_000 })
  const lesson = course.draft.lessons.find(item => item.id === lessonId)
  insist(lesson, 'lesson_not_found', 404)
  insist(lesson.sources.length > 0, 'lesson_cites_no_source')
  const draft = { ...course.draft, lessons: course.draft.lessons.map(item => item.id === lessonId ? { ...item, body } : item) }
  const proposal = await createProposal(env, actor, { course: course.id, draftVersion: input.integer('draftVersion', { min: 1, max: 1_000_000 })!, inputs: lesson.sources, draft, agent: null, summary: input.text('summary', { max: 2000 }), passages: [], missing: [] }, { thread: thread.id })
  await commit(env, [stmt(env, 'UPDATE beam_discussion_threads SET proposal_id = ? WHERE id = ? AND proposal_id IS NULL', proposal.id, thread.id)], { actor, action: 'discussion.propose', subject: thread.id, detail: { proposal: proposal.id, lesson: lessonId, sources: lesson.sources } })
  return { id: thread.id, proposal: proposal.id }
}

/** A moderator approves a pending attachment or removes an unsafe one with a reason. */
export async function decideFile(env: Bindings, actor: Actor, input: Input) {
  const file = await one(env, 'SELECT f.id, f.state, t.course_id FROM beam_discussion_files f JOIN beam_discussion_posts p ON p.id = f.post_id JOIN beam_discussion_threads t ON t.id = p.thread_id WHERE f.id = ?', input.text('file', { max: 64 }))
  if (!file) throw new BeamError('not_found', 404)
  const mine = await requireReader(env, actor, file.course_id)
  insist(mine.moderator, 'moderators_only', 403)
  const decision = input.text('decision', { max: 10 })
  insist(decision === 'approve' || decision === 'remove', 'invalid_decision')
  insist(decision === 'remove' || file.state === 'pending', 'file_decided', 409)
  const reason = decision === 'remove' ? input.text('reason', { max: 500 }) : null
  await commit(env, [stmt(env, 'UPDATE beam_discussion_files SET state = ?, decided_by = ?, decided_at = ?, reason = ? WHERE id = ?', decision === 'approve' ? 'approved' : 'removed', actor.id, now(), reason, file.id)],
    { actor, action: `discussion.file.${decision}`, subject: file.id, detail: { reason } })
  return { id: file.id, state: decision === 'approve' ? 'approved' : 'removed' }
}

/** A moderator hides a post with a reason; it stays in the record, shown only to moderators. */
export async function hidePost(env: Bindings, actor: Actor, input: Input) {
  const post = await one(env, 'SELECT p.id, t.course_id FROM beam_discussion_posts p JOIN beam_discussion_threads t ON t.id = p.thread_id WHERE p.id = ? AND p.hidden_at IS NULL', input.text('post', { max: 64 }))
  if (!post) throw new BeamError('not_found', 404)
  insist((await requireReader(env, actor, post.course_id)).moderator, 'moderators_only', 403)
  const reason = input.text('reason', { max: 500 })
  await commit(env, [stmt(env, 'UPDATE beam_discussion_posts SET hidden_by = ?, hidden_at = ?, hidden_reason = ? WHERE id = ?', actor.id, now(), reason, post.id)], { actor, action: 'discussion.hide', subject: post.id, detail: { reason } })
  return { id: post.id }
}

/** A course's threads as this person may see them: hidden posts and pending or removed files only for moderators
 * (and a pending file for its uploader). */
export async function courseDiscussions(env: Bindings, actor: Actor, course: string) {
  const mine = await requireReader(env, actor, course)
  const [info, threads, posts, files, lessons, draft] = await Promise.all([
    one(env, 'SELECT id, title FROM beam_courses WHERE id = ?', course),
    all(env, 'SELECT t.id, t.kind, t.title, t.state, t.lesson_revision_id AS lesson, l.title AS lessonTitle, t.answer_post_id AS answer, t.proposal_id AS proposal, t.created_by AS createdBy, m.name AS createdByName, t.created_at AS createdAt, t.resolved_at AS resolvedAt FROM beam_discussion_threads t JOIN beam_lesson_revisions l ON l.id = t.lesson_revision_id JOIN beam_members m ON m.id = t.created_by WHERE t.course_id = ? ORDER BY t.created_at DESC, t.rowid DESC', course),
    all(env, 'SELECT p.id, p.thread_id AS thread, p.author_id AS author, m.name AS authorName, p.expert, p.body, p.created_at AS createdAt, p.hidden_at AS hiddenAt, p.hidden_reason AS hiddenReason FROM beam_discussion_posts p JOIN beam_members m ON m.id = p.author_id JOIN beam_discussion_threads t ON t.id = p.thread_id WHERE t.course_id = ? ORDER BY p.created_at, p.rowid', course),
    all(env, 'SELECT f.id, f.post_id AS post, f.state, f.reason, a.filename, a.media_type AS mediaType, a.size, a.uploaded_by AS uploadedBy FROM beam_discussion_files f JOIN beam_attachments a ON a.id = f.attachment_id JOIN beam_discussion_posts p ON p.id = f.post_id JOIN beam_discussion_threads t ON t.id = p.thread_id WHERE t.course_id = ?', course),
    all(env, 'SELECT l.id, l.title, l.position FROM beam_lesson_revisions l JOIN beam_courses c ON c.published_revision_id = l.course_revision_id WHERE c.id = ? ORDER BY l.position', course),
    mine.expert ? loadCourse(env, course).then(row => ({ draftVersion: row.draft_version as number, lessons: row.draft.lessons.map(item => ({ id: item.id, title: item.title, body: item.body, sources: item.sources })) })) : null,
  ])
  const fileVisible = (file: Row) => file.state === 'approved' || (mine.moderator) || (file.state === 'pending' && file.uploadedBy === actor.id)
  return {
    course: info, standing: mine, lessons, draft,
    threads: threads.map(thread => ({
      ...thread,
      posts: posts.filter(post => post.thread === thread.id && (!post.hiddenAt || mine.moderator)).map(post => ({ ...post, expert: !!post.expert, hidden: !!post.hiddenAt, files: files.filter(file => file.post === post.id && fileVisible(file)) }) as Row),
    }) as Row),
  }
}

/** In-app notices: a person's questions with an expert answer since they last posted, and for experts the open
 * questions on their courses that no expert has answered. */
export async function discussionNotices(env: Bindings, actor: Actor) {
  const [answered, waiting] = await Promise.all([
    all(env, `SELECT t.id, t.course_id AS course, t.title, c.title AS courseTitle FROM beam_discussion_threads t JOIN beam_courses c ON c.id = t.course_id WHERE t.created_by = ?1
      AND (SELECT MAX(created_at) FROM beam_discussion_posts WHERE thread_id = t.id AND expert = 1 AND hidden_at IS NULL AND author_id <> ?1) > (SELECT MAX(created_at) FROM beam_discussion_posts WHERE thread_id = t.id AND author_id = ?1) ORDER BY t.created_at DESC`, actor.id),
    all(env, `SELECT t.id, t.course_id AS course, t.title, c.title AS courseTitle FROM beam_discussion_threads t JOIN beam_courses c ON c.id = t.course_id
      WHERE t.kind = 'question' AND t.state = 'open' AND (c.reviewer_id = ?1 OR EXISTS (SELECT 1 FROM beam_course_authors x WHERE x.course_id = c.id AND x.member_id = ?1))
      AND NOT EXISTS (SELECT 1 FROM beam_discussion_posts p WHERE p.thread_id = t.id AND p.expert = 1 AND p.hidden_at IS NULL) ORDER BY t.created_at`, actor.id),
  ])
  return { answered, waiting }
}

/** An attachment, downloaded as inert bytes by those who may see it; a removed one is never served. */
export async function discussionFile(env: Bindings, actor: Actor, id: string) {
  const row = await one(env, 'SELECT f.state, t.course_id, a.filename, a.media_type AS mediaType, a.size, a.sha256, a.uploaded_by AS uploadedBy FROM beam_discussion_files f JOIN beam_attachments a ON a.id = f.attachment_id JOIN beam_discussion_posts p ON p.id = f.post_id JOIN beam_discussion_threads t ON t.id = p.thread_id WHERE f.id = ?', id)
  if (!row || row.state === 'removed') throw new BeamError('not_found', 404)
  const mine = await requireReader(env, actor, row.course_id)
  if (row.state === 'pending' && !mine.moderator && row.uploadedBy !== actor.id) throw new BeamError('not_found', 404)
  return serve(env, { filename: row.filename, mediaType: row.mediaType, size: row.size, sha256: row.sha256 }, { download: true })
}
