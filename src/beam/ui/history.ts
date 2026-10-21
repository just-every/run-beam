// Course history pages (AUTHOR-004): compare two revisions, compare two source
// versions, and restore an earlier revision into the draft.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all, type Row } from '../core'
import { courseDetail } from '../courses'
import type { LineDiff } from '../diff'
import { compareRevisions, compareSourceVersions } from '../history'
import { business, memberNames } from '../people'
import { listSources } from '../sources'
import { backLink, bytes, card, form, h, hidden, page, select, when, type Html } from './html'

const RULES: Record<string, string> = { title: 'Title', summary: 'Summary', passPercent: 'Pass mark (%)', maxAttempts: 'Quiz attempts allowed', timeLimitMinutes: 'Time limit (minutes)', practicalAssessor: 'Practical assessor', drawCount: 'Questions drawn per attempt', shuffle: 'Shuffled question order', feedback: 'When learners see which answers were right', attendancePercent: 'Attendance required (%)' }
const FEEDBACKS: Record<string, string> = { attempt: 'after every attempt', final: 'once passed or out of attempts', score: 'never (score only)' }
const CHANGES: Record<string, string> = { same: 'unchanged', moved: 'moved', changed: 'changed', added: 'added', removed: 'removed' }

/** A line comparison as a list: added lines are <ins>, removed lines <del>, each also marked + or − in text. */
export function diffList(diff: LineDiff): Html {
  if ('tooLarge' in diff) return h`<p class="muted">Too many lines changed to compare line by line.</p>`
  if (!diff.lines.length) return h`<p class="muted">Empty in both.</p>`
  return h`<ul class="diff">${diff.lines.map(line => line.op === 'add' ? h`<li><ins>+ ${line.text}</ins></li>` : line.op === 'del' ? h`<li><del>− ${line.text}</del></li>` : h`<li>&nbsp; ${line.text}</li>`)}</ul>`
}

/** The GET form that picks two revisions of a course to compare. */
export function compareForm(courseId: string, revisions: Row[], from = '', to = '') {
  const options = revisions.map(revision => ({ value: revision.id, label: `Revision ${revision.number}` }))
  return h`<form method="get" action="/app/courses/${courseId}/compare">${select('Earlier revision', 'from', options, from || revisions[1]?.id || '')}${select('Later revision', 'to', options, to || revisions[0]?.id || '')}<button type="submit" class="secondary">Compare</button></form>`
}

export async function revisionComparePage(env: Bindings, actor: Actor, courseId: string, url: URL) {
  const course = await courseDetail(env, actor, courseId)
  const from = url.searchParams.get('from') ?? '', to = url.searchParams.get('to') ?? ''
  const compared = await compareRevisions(env, actor, from, to)
  if (compared.course !== courseId) return page('Compare', actor, h`<h1>Those revisions belong to another course</h1>`, { status: 404 })
  // A course's own author (ORG-003) has no global source list: the versions the two revisions cite are named from the lessons.
  const cited = [...new Set(compared.lessons.flatMap(lesson => [...lesson.sources.added, ...lesson.sources.removed]))]
  const [versions, names] = await Promise.all([cited.length ? all<{ id: string; number: number; title: string }>(env, `SELECT v.id, v.number, s.title FROM beam_source_versions v JOIN beam_sources s ON s.id = v.source_id WHERE v.id IN (${cited.map(() => '?').join(',')})`, ...cited) : [], memberNames(env)])
  const label = new Map(versions.map(version => [version.id, `${version.title} v${version.number}`] as const))
  const author = actor.owner || actor.roles.has('author') || actor.authorOf.includes(courseId)
  const ruleValue = (name: string, value: unknown) => value === null ? 'none' : name === 'practicalAssessor' ? names.get(String(value)) ?? String(value) : name === 'shuffle' ? (value ? 'on' : 'off') : name === 'feedback' ? FEEDBACKS[String(value)] ?? String(value) : String(value)
  const body = h`${backLink(`/app/courses/${courseId}`, course.title)}<h1>Revision ${compared.from.number} compared with revision ${compared.to.number}</h1>
<p class="subtitle">${compared.changed ? 'Changes from the earlier to the later revision.' : 'The two revisions teach and assess the same content.'}</p>
<section class="card settings">${compareForm(courseId, course.revisions, from, to)}</section>
${card('Details', h`<ul>${compared.details.map(rule => h`<li>${RULES[rule.name]}: ${rule.changed ? h`<del>${rule.from}</del> → <ins>${rule.to}</ins>` : h`${rule.to} (unchanged)`}</li>`)}</ul>`)}
${card('Lessons', compared.lessons.map(lesson => h`<section><h3>${lesson.to ? `${lesson.to.position}. ${lesson.to.title}` : `${lesson.from!.position}. ${lesson.from!.title}`} — ${CHANGES[lesson.change]}${lesson.change === 'moved' ? ` from position ${lesson.from!.position}` : ''}</h3>${lesson.change === 'same' || lesson.change === 'moved' ? '' : diffList(lesson.body)}${lesson.sources.added.length || lesson.sources.removed.length ? h`<p class="muted">Cited sources: ${lesson.sources.added.map(id => h`<ins>+ ${label.get(id) ?? id}</ins> `)}${lesson.sources.removed.map(id => h`<del>− ${label.get(id) ?? id}</del> `)}</p>` : ''}</section>`))}
${card('Assessment', h`<ul>${compared.assessment.rules.map(rule => h`<li>${RULES[rule.name]}: ${rule.changed ? h`<del>${ruleValue(rule.name, rule.from)}</del> → <ins>${ruleValue(rule.name, rule.to)}</ins>` : h`${ruleValue(rule.name, rule.to)} (unchanged)`}</li>`)}</ul>
<h3>Practical instructions</h3>${diffList(compared.assessment.practical)}
<h3>Questions</h3>${compared.assessment.questions.length ? compared.assessment.questions.map(question => h`<section><h4>${question.prompt.to ?? question.prompt.from} — ${CHANGES[question.change]}${question.change === 'moved' ? ` from position ${question.fromPosition} to ${question.toPosition}` : ''}</h4>${question.change === 'same' ? '' : h`${question.prompt.from !== null && question.prompt.to !== null && question.prompt.from !== question.prompt.to ? h`<p><del>${question.prompt.from}</del> → <ins>${question.prompt.to}</ins></p>` : ''}${diffList(question.choices)}`}</section>`) : h`<p class="muted">No quiz in either revision.</p>`}`)}
${card('Satisfaction survey', diffList(compared.survey))}
${author ? h`<section class="card"><h2>Restore</h2><p>Copies a revision's lessons, quiz and rules into the draft. The draft then goes through review as a new revision; earlier revisions, assignments and completions stay as they are.</p>${[compared.from, compared.to].map(side => form('course.restore', `/app/courses/${courseId}`, [hidden('course', courseId), hidden('draftVersion', course.draftVersion), hidden('revision', side.id)], `Restore revision ${side.number} into the draft`, { secondary: true }))}</section>` : ''}`
  return page(`Compare revisions`, actor, body, { current: '/app/courses', url })
}

export async function sourceComparePage(env: Bindings, actor: Actor, sourceId: string, url: URL) {
  const sources = await listSources(env, actor)
  const source = sources.find(item => item.id === sourceId)
  if (!source) return page('Compare', actor, h`<h1>Source not found</h1>`, { status: 404 })
  const versions = [...source.versions].reverse()
  const from = url.searchParams.get('from') || versions[1]?.id || '', to = url.searchParams.get('to') || versions[0]?.id || ''
  const compared = await compareSourceVersions(env, actor, from, to)
  const [names, zone] = await Promise.all([memberNames(env), business(env).then(value => value!.timezone)])
  const options = versions.map((version: any) => ({ value: version.id, label: `Version ${version.number}` }))
  const facts = (side: typeof compared.from) => h`<li>Version ${side.number}: ${side.filename}, ${bytes(side.size)}, uploaded ${when(side.uploadedAt, zone)} by ${names.get(side.uploadedBy)} — ${side.provenance}<br><span class="muted">SHA-256 ${side.sha256}</span></li>`
  const body = h`${backLink('/app/sources', 'Sources')}<h1>${compared.title}: version ${compared.from.number} compared with version ${compared.to.number}</h1>
<section class="card settings"><form method="get" action="/app/sources/${sourceId}/compare">${select('Earlier version', 'from', options, from)}${select('Later version', 'to', options, to)}<button type="submit" class="secondary">Compare</button></form></section>
${card('Files', h`<ul>${facts(compared.from)}${facts(compared.to)}</ul><p>${compared.sameBytes ? 'Both versions hold identical bytes.' : 'The bytes differ.'}</p>`)}
${card('Text', compared.text ? diffList(compared.text) : h`<p class="muted">${compared.textNote}</p>`)}`
  return page('Compare versions', actor, body, { current: '/app/sources', url })
}
