// AGENT-004 on the course page: a source-change notice with what the change invalidates and what it leaves
// untouched, Beam's exact-quote impact proposal, and the named reviewer's materiality and retraining decision.
import type { noticeImpact } from '../impact'
import { card, checks, field, form, h, hidden, rows, select } from './html'
import { decisionFields } from './upkeep'

type Impact = Awaited<ReturnType<typeof noticeImpact>>
const PART: Record<string, string> = { answer: 'its answer', prompt: 'its wording', unknown: 'not compared' }

export function impactCard(impact: Impact, back: string, { author, decides }: { author: boolean; decides: boolean }) {
  const changes = impact.changes.length ? h`<h3>Changed passages</h3><ul>${impact.changes.map(change => h`<li>${change.removed.length ? h`<del>${change.removed.join(' / ')}</del> ` : ''}${change.added.length ? h`<ins>${change.added.join(' / ')}</ins>` : ''}</li>`)}</ul>` : ''
  const affected = rows([
    ...impact.lessons.affected.map(lesson => ({ title: `Lesson “${lesson.title}”`, meta: lesson.passages.length ? lesson.passages.map(passage => `“${passage.text}”`).join(' · ') : 'cites the source' })),
    ...impact.questions.affected.map(question => ({ title: `Question “${question.prompt}”`, meta: PART[question.part ?? 'unknown'] })),
    ...(impact.practical?.affected ? [{ title: 'Practical assessment instructions', meta: impact.practical.changes.map(line => `“${line}”`).join(' · ') }] : []),
    ...impact.scenarios.filter(scenario => scenario.affected).map(scenario => ({ title: `Practice scenario “${scenario.title}”`, meta: scenario.changes.map(line => `“${line}”`).join(' · ') })),
    ...impact.packages.filter(item => item.affected).map(item => ({ title: `${item.type === 'xapi' ? 'xAPI activity' : 'Package'} “${item.title}” metadata`, meta: item.passages.length ? item.passages.map(passage => `${passage.field}: “${passage.text}”`).join(' · ') : 'cites the source; a person checks the original material' })),
  ])
  const untouched = [...impact.lessons.untouched.map(lesson => `lesson “${lesson.title}”`), ...impact.questions.untouched.map(question => `question “${question.prompt}”`), ...impact.scenarios.filter(scenario => !scenario.affected).map(scenario => `scenario “${scenario.title}”`), ...impact.packages.filter(item => !item.affected).map(item => `${item.type === 'xapi' ? 'xAPI activity' : 'package'} “${item.title}” metadata`)]
  const hasAffected = impact.lessons.affected.length + impact.questions.affected.length + impact.scenarios.filter(item => item.affected).length + impact.packages.filter(item => item.affected).length + Number(!!impact.practical?.affected) > 0
  const roles = impact.roles.length ? rows(impact.roles.map(role => ({ title: role.jobRole, meta: `${role.mapped ? 'mapped to this course’s skills · ' : ''}${role.people} ${role.people === 1 ? 'person' : 'people'}, ${role.completed} completed an earlier revision${role.renewals.length ? ` · renewals ${role.renewals.map(renewal => `${renewal.on} (${renewal.count})`).join(', ')}` : ''}${role.withoutRenewal ? ` · ${role.withoutRenewal} without a renewal date` : ''}` }))) : h`<p class="muted">No job role is mapped to this course or held by someone who completed it.</p>`
  const propose = author ? form('impact.propose', back, [hidden('notice', impact.notice), hidden('draftVersion', impact.draftVersion)], 'Draft only the affected changes', { secondary: true }) : ''
  const decide = decides ? form('notice.decide', back, [hidden('notice', impact.notice), ...decisionFields(),
    select('Retraining (when the training needs updating)', 'retraining', [{ value: 'none', label: 'No retraining: earlier completions stand until their own renewal dates' }, { value: 'required', label: 'Retraining required for the roles below' }]),
    impact.roles.length ? checks('Roles to retrain', 'retrainRoles', impact.roles.map(role => ({ value: role.jobRole, label: role.jobRole }))) : '',
    field('Retrain by', 'retrainDueOn', { type: 'date', required: false, hint: 'Needed when retraining is required: a date after today, in the business time zone.' }),
  ], 'Record decision') : h`<p class="muted">The course’s named reviewer or the owner decides materiality and retraining.</p>`
  return card('Source changed', h`<p>“${impact.sourceTitle}” moved from version ${impact.from.number} to ${impact.to.number}.${impact.compareNote ? ` ${impact.compareNote}` : ''}</p>${changes}<h3>Affected</h3>${hasAffected ? affected : h`<p class="muted">Nothing in this course teaches a changed passage.</p>`}<h3>Untouched</h3><p class="muted">${untouched.length ? untouched.join(', ') : 'nothing else'}.</p><h3>Affected job roles</h3>${roles}${propose}${decide}`)
}

/** Notices for a person who may not read the impact: the plain decision form. */
export const noticeCard = (notice: { id: string; source_title: string; previous_number: number; new_number: number }, back: string) =>
  card('Source changed', h`<p>“${notice.source_title}” moved from version ${notice.previous_number} to ${notice.new_number}. The published course material cites version ${notice.previous_number}.</p><p class="muted">The course’s authors, its named reviewer and the owner see what the change affects.</p>`)
