// AUTHOR-003 on the pages: a course's open lesson conflicts with both texts and the ways to resolve them, comment threads
// under each draft lesson and question, the content queue of learner feedback, and the learner's feedback form.
import type { Row } from '../core'
import { area, card, field, form, h, hidden, rows, select, when } from './html'

const KIND: Record<string, string> = { feedback: 'Feedback', broken: 'Something is broken' }

export function conflictsCard(conflicts: Row[], course: string, draftVersion: number, zone: string) {
  const open = conflicts.filter(conflict => !conflict.resolution)
  if (!open.length) return ''
  const back = `/app/courses/${course}`, base = [hidden('course', course), hidden('draftVersion', draftVersion)]
  return card('Conflicting edits', open.map(conflict => h`<section><h3>${conflict.theirs.title}</h3><p class="muted">${conflict.authorName} saved this lesson ${when(conflict.createdAt, zone)} from an older draft; someone had changed it meanwhile.</p>
<div class="split"><div><h4>Current text</h4><p>${conflict.theirs.title}</p><p>${conflict.theirs.body}</p></div><div><h4>${conflict.authorName}’s text</h4><p>${conflict.mine.title}</p><p>${conflict.mine.body}</p></div></div>
${form('conflict.resolve', back, [...base, hidden('conflict', conflict.id), hidden('choice', 'kept_current')], 'Keep the current text', { secondary: true })}${form('conflict.resolve', back, [...base, hidden('conflict', conflict.id), hidden('choice', 'used_mine')], `Use ${conflict.authorName}’s text`, { secondary: true })}
<details><summary>Save a merged text</summary>${form('conflict.resolve', back, [...base, hidden('conflict', conflict.id), hidden('choice', 'merged'), field('Lesson title', 'title', { value: conflict.mine.title }), area('Lesson text', 'body', `${conflict.theirs.body}\n\n${conflict.mine.body}`)], 'Save merged text')}</details></section>`), { id: 'conflicts' })
}

/** The threads on one draft lesson or question, with reply, resolve and new-thread forms. */
export function threadsFor(threads: Row[], course: string, targetKind: 'lesson' | 'question', target: string, zone: string) {
  const back = `/app/courses/${course}`
  const mine = threads.filter(thread => thread.targetKind === targetKind && thread.target === target)
  const line = (comment: Row) => h`<strong>${comment.authorName}</strong>, ${when(comment.createdAt, zone)}: ${comment.body}`
  return h`<div class="threads">${mine.map(thread => h`<section class="thread"><p>${thread.kind === 'change' ? h`<strong>${thread.resolvedAt ? 'Change request (resolved)' : 'Change requested'}</strong> · ` : ''}${line(thread)}</p>${thread.replies.map((reply: Row) => h`<p>${line(reply)}</p>`)}
${thread.resolvedAt ? h`<p class="muted">Resolved by ${thread.resolvedByName}, ${when(thread.resolvedAt, zone)}</p>` : h`${form('course.comment', back, [hidden('course', course), hidden('thread', thread.id), area('Reply', 'body')], 'Reply', { secondary: true })}${form('course.thread.resolve', back, [hidden('thread', thread.id)], 'Resolve thread', { secondary: true })}`}</section>`)}
<details><summary>Comment or request a change</summary>${form('course.comment', back, [hidden('course', course), hidden('targetKind', targetKind), hidden('target', target), select('Kind', 'kind', [{ value: 'comment', label: 'Comment' }, { value: 'change', label: 'Request a change' }], 'comment'), area('Comment', 'body')], 'Add comment', { secondary: true })}</details></div>`
}

/** Open learner feedback; names only for the people responsible for the course. */
export function queueCard(items: Row[], zone: string, returnTo: string, heading = 'Content feedback') {
  if (!items.length) return ''
  return card(heading, rows(items.map(item => ({ title: h`${KIND[item.kind]} — ${item.courseTitle}${item.lessonTitle ? `: ${item.lessonTitle}` : ''}`, meta: h`${item.body}<br>${item.learnerName ? `From ${item.learnerName}` : 'From a learner'} · revision ${item.revisionNumber} · ${when(item.createdAt, zone)}`,
    aside: item.canClose ? form('feedback.close', returnTo, [hidden('feedback', item.id), field('What was done', 'note')], 'Close', { secondary: true }) : '' }))), { id: 'content-feedback' })
}

/** The learner's form on a lesson, and their earlier feedback on the course with each outcome. */
export function feedbackForm(assignment: string, lesson: string | null, returnTo: string) {
  return card('Tell us about this lesson', form('feedback.send', returnTo, [hidden('assignment', assignment), lesson ? hidden('lesson', lesson) : '', select('Kind', 'kind', Object.entries(KIND).map(([value, label]) => ({ value, label })), 'feedback'), area('What should the course team know?', 'body')], 'Send', { secondary: true }), { id: 'feedback' })
}

export function myFeedbackCard(items: Row[], zone: string) {
  if (!items.length) return ''
  return card('Your feedback', rows(items.map(item => ({ title: `${KIND[item.kind]}${item.lessonTitle ? `: ${item.lessonTitle}` : ''}`, meta: `${item.body} · ${when(item.createdAt, zone)}${item.state === 'closed' ? ` · closed: ${item.closeNote}` : ' · open'}` }))), { id: 'my-feedback' })
}
