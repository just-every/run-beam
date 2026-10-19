// LEARN-014: a course's discussions page. The cohort asks lesson questions and replies; experts answer, resolve and
// turn an answer into a proposed lesson update; moderators approve or remove shared files and hide posts. My learning
// lists answers waiting for the asker and questions waiting for an expert.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import type { Row } from '../core'
import { courseDiscussions, discussionNotices } from '../discussions'
import { business } from '../people'
import { area, backLink, bytes, card, field, fileField, form, h, hidden, page, pill, rows, select, when } from './html'

type View = Awaited<ReturnType<typeof courseDiscussions>>
const FILE_STATE: Record<string, string> = { pending: 'waiting for review: only you and moderators see it', approved: 'reviewed', removed: 'removed' }

function thread(view: View, item: View['threads'][number], zone: string, returnTo: string) {
  const { standing } = view
  const posts = item.posts.map((post: Row) => h`<li class="post${post.expert ? ' expert' : ''}"><p><strong>${post.authorName}</strong>${post.expert ? ' · course expert' : ''} · ${when(post.createdAt, zone)}${item.answer === post.id ? ' · answer' : ''}${post.hidden ? h` · hidden: ${post.hiddenReason}` : ''}</p><p>${post.body}</p>
${post.files.map((file: Row) => h`<p class="muted">${file.state === 'removed' ? h`File ${file.filename} removed: ${file.reason}` : h`<a href="/app/files/discussion/${file.id}">${file.filename}</a> (${bytes(file.size)}${file.state === 'pending' ? `, ${FILE_STATE.pending}` : ''})`}</p>
${standing.moderator && file.state === 'pending' ? form('discussion.file', returnTo, [hidden('file', file.id), hidden('decision', 'approve')], 'Approve the file', { secondary: true }) : ''}
${standing.moderator && file.state !== 'removed' ? form('discussion.file', returnTo, [hidden('file', file.id), hidden('decision', 'remove'), field('Why remove it', 'reason')], 'Remove the file', { secondary: true }) : ''}`)}
${standing.expert && item.kind === 'question' && item.state === 'open' && !post.hidden ? form('discussion.resolve', returnTo, [hidden('thread', item.id), hidden('answer', post.id)], 'Resolve with this answer', { secondary: true }) : ''}
${standing.moderator && !post.hidden ? form('discussion.hide', returnTo, [hidden('post', post.id), field('Why hide it', 'reason')], 'Hide', { secondary: true }) : ''}</li>`)
  const propose = standing.expert && view.draft && item.state === 'resolved' && !item.proposal ? h`<details><summary>Propose a lesson update from this answer</summary>${form('discussion.propose', returnTo, [hidden('thread', item.id), hidden('draftVersion', view.draft.draftVersion), select('Draft lesson', 'draftLesson', view.draft.lessons.filter(lesson => lesson.sources.length).map(lesson => ({ value: lesson.id, label: lesson.title }))), area('New lesson text', 'lessonBody'), area('What changes and why', 'summary')], 'Send the proposal to the reviewer')}</details>` : ''
  return card(item.title, h`<p>${pill(item.state === 'resolved' ? 'completed' : 'open', item.kind === 'question' ? (item.state === 'resolved' ? 'Answered' : 'Question') : 'Discussion')} Lesson “${item.lessonTitle}” · asked by ${item.createdByName}${item.proposal ? ' · update proposed to the reviewer' : ''}</p>
<ol class="posts">${posts}</ol>
${form('discussion.reply', returnTo, [hidden('thread', item.id), area('Reply', 'body'), fileField('Photo or PDF (optional)', 'file', { accept: 'image/*,application/pdf' })], 'Reply', { multipart: true, secondary: true })}${propose}`, { id: `thread-${item.id}` })
}

export async function discussionsPage(env: Bindings, actor: Actor, course: string, url: URL) {
  const view = await courseDiscussions(env, actor, course)
  const zone = (await business(env))!.timezone
  const returnTo = `/app/discussions/${course}`
  const lesson = url.searchParams.get('lesson') ?? ''
  const ask = view.lessons.length ? card('Ask a question or start a discussion', h`<p class="muted">Your name shows with what you post. Course experts answer here; discussion never counts toward completing the course.</p>${form('discussion.ask', returnTo, [hidden('course', course), select('Lesson', 'lesson', view.lessons.map(item => ({ value: item.id, label: item.title })), lesson), select('Kind', 'kind', [{ value: 'question', label: 'Question for an expert' }, { value: 'discussion', label: 'Discussion' }]), field('Title', 'title'), area('Your question', 'body'), fileField('Photo or PDF (optional)', 'file', { accept: 'image/*,application/pdf' })], 'Post', { multipart: true })}`, { id: 'ask' }) : ''
  const body = h`${backLink('/app/learning', 'My learning')}<h1>${view.course!.title}: discussion</h1>${ask}${view.threads.length ? view.threads.map(item => thread(view, item, zone, returnTo)) : h`<p>No questions yet.</p>`}`
  return page(`${view.course!.title} discussion`, actor, body, { current: '/app/learning', url })
}

/** My learning: answers to my questions and questions waiting for me as a course expert. */
export async function discussionCard(env: Bindings, actor: Actor) {
  const { answered, waiting } = await discussionNotices(env, actor)
  if (!answered.length && !waiting.length) return ''
  return card('Discussions', rows([
    ...answered.map(row => ({ title: row.title, meta: `${row.courseTitle} · an expert answered`, href: `/app/discussions/${row.course}#thread-${row.id}` })),
    ...waiting.map(row => ({ title: row.title, meta: `${row.courseTitle} · waiting for an expert`, href: `/app/discussions/${row.course}#thread-${row.id}` })),
  ]), { id: 'discussions' })
}
