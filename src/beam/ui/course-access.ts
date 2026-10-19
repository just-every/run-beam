// ORG-003 on the course page: who may author this course, its reviewer handovers, and the owner's self-review switch.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all } from '../core'
import { area, card, checks, form, h, hidden, rows, select, when } from './html'

export async function courseAccessCard(env: Bindings, actor: Actor, course: Record<string, any>, names: Map<string, string>, zone: string) {
  const manage = actor.owner || (course.unit && actor.adminUnits.includes(course.unit))
  const back = `/app/courses/${course.id}`
  const history = course.reviewerChanges.length ? rows(course.reviewerChanges.map((change: any) => ({ title: `${names.get(change.previousReviewer)} → ${names.get(change.reviewer)}`, meta: `${when(change.changedAt, zone)} by ${names.get(change.changedBy)}: ${change.reason}` }))) : ''
  const authors = course.authors.length ? `Course authors: ${course.authors.map((author: any) => author.name).join(', ')}.` : 'Only people with the author role write this course.'
  const self = course.selfReview ? 'Self-review is allowed: whoever submits a revision may decide it, and it is labelled self-reviewed.' : 'Self-review is off: the named reviewer decides other people’s revisions.'
  if (!manage) return card('Authors and reviewer', h`<p class="muted">${authors} ${self}</p>${history}`)
  const people = (await all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_members ORDER BY name')).map(member => ({ value: member.id, label: member.name }))
  return card('Authors and reviewer', h`<p class="muted">${self}</p>${history}
<details><summary>Course authors</summary>${form('course.authors', back, [hidden('course', course.id), checks('People who may write this course', 'members', people, course.authors.map((author: any) => author.id), { scroll: true })], 'Save authors')}</details>
<details><summary>Replace the reviewer</summary>${form('course.reviewer', back, [hidden('course', course.id), select('New reviewer', 'reviewer', people.filter(person => person.value !== course.reviewer)), area('Reason', 'reason')], 'Replace reviewer')}</details>
${actor.owner ? form('course.selfreview', back, [hidden('course', course.id), hidden('allowed', course.selfReview ? 'no' : 'yes')], course.selfReview ? 'Turn self-review off' : 'Allow self-review', { secondary: true }) : ''}`)
}
