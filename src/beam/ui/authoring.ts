// Author and reviewer pages: sources, courses, the draft editor, revisions,
// source-change notices and proposals.
import type { Bindings } from '../../auth.server'
import { requireRole, type Actor } from '../actor'
import { courseDetail, listCourses, revisionDetail } from '../courses'
import { BeamError } from '../core'
import { business, memberNames, membersWithRole } from '../people'
import { listSources } from '../sources'
import { compareForm } from './history'
import { acknowledgmentList } from '../acknowledgments'
import { isManager } from '../actor'
import { all } from '../core'
import { sourceAcknowledgments } from './acknowledgments'
import { agentName, area, backLink, bytes, card, checks, field, fileField, form, h, hidden, lessonText, page, rows, select, when } from './html'
import { accessRule } from '../access'
import { describeRule, windowForm } from './access'

const LICENCES: Record<string, string> = { owned: 'owned', licensed: 'licensed to the business', permission: 'used with written permission' }
const STATES: Record<string, string> = { draft: 'draft', in_review: 'in review', published: 'published', superseded: 'superseded', returned: 'returned' }
const state = (value: string) => STATES[value] ?? value.replace(/_/g, ' ')
const KINDS: Record<string, string> = { 'application/pdf': 'PDF', 'text/plain': 'Text', 'text/markdown': 'Text', 'text/csv': 'CSV', 'image/png': 'PNG image', 'image/jpeg': 'JPEG image', 'video/mp4': 'MP4 video', 'audio/mpeg': 'MP3 audio', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel workbook' }
const fileKind = (mediaType: string) => KINDS[mediaType] ?? (mediaType.split('/')[1]?.split(/[.+;-]/)[0]?.toUpperCase() || 'File')

export async function sourcesPage(env: Bindings, actor: Actor, url: URL) {
  const [sources, reviewers, names, acknowledgments, teams] = await Promise.all([listSources(env, actor), membersWithRole(env, 'reviewer'), memberNames(env), acknowledgmentList(env, actor), isManager(actor) ? all(env, 'SELECT id, name FROM beam_teams ORDER BY name') : []])
  const people = [...names].map(([value, label]) => ({ value, label }))
  const zone = (await business(env))!.timezone
  const canAuthor = actor.owner || actor.roles.has('author')
  const body = h`<h1>Source library</h1><p class="lede">Owned procedures and media that lessons are built from. Each version is kept unchanged with its provenance.</p>
${sources.length ? '' : h`<p class="card muted">No sources yet.</p>`}
${sources.map(source => card(source.title, h`<p class="muted">License: ${LICENCES[source.licence] ?? source.licence} — ${source.licenceEvidence}<br>Responsible reviewer: ${names.get(source.reviewer)}</p>${rows(source.versions.map((version: any) => ({ title: h`Version ${version.number}: <a href="/app/files/source/${version.id}">${version.filename}</a>`, meta: `${fileKind(version.mediaType)}, ${bytes(version.size)}, uploaded ${when(version.uploadedAt, zone)} by ${names.get(version.uploadedBy)} — ${version.provenance}` })))}
${source.versions.length > 1 ? h`<p><a href="/app/sources/${source.id}/compare">Compare versions</a></p>` : ''}${sourceAcknowledgments(actor, source.id, acknowledgments.managed, people, teams.map(team => ({ value: team.id, label: team.name })), zone)}${canAuthor ? h`<details><summary>Upload a new version</summary>${form('source.version', '/app/sources', [hidden('source', source.id), fileField('File', 'file', { required: true }), field('Where this version came from', 'provenance')], 'Upload version', { multipart: true })}</details>` : ''}`))}
${canAuthor ? h`<section class="card settings"><h2>Add a source</h2>${form('source.create', '/app/sources', [field('Title', 'title'), fileField('File', 'file', { required: true }), select('License', 'licence', [{ value: 'owned', label: 'Owned by the business' }, { value: 'licensed', label: 'Licensed to the business' }, { value: 'permission', label: 'Used with written permission' }]), area('License evidence', 'licenceEvidence'), field('Where it came from', 'provenance'), select('Responsible reviewer', 'reviewer', reviewers.map(member => ({ value: member.id, label: member.name })))], 'Add source', { multipart: true })}</section>` : ''}`
  return page('Sources', actor, body, { current: '/app/sources', url })
}

export async function coursesPage(env: Bindings, actor: Actor, url: URL) {
  requireRole(actor, 'author', 'reviewer', 'manager')
  const [courses, reviewers] = await Promise.all([listCourses(env), membersWithRole(env, 'reviewer')])
  const body = h`<h1>Courses</h1>${card('Course list', courses.length ? rows(courses.map(course => ({ title: course.title, meta: `${course.publishedNumber ? `published revision ${course.publishedNumber}` : 'not published'}${course.inReview ? ' · revision in review' : ''}`, href: `/app/courses/${course.id}` }))) : h`<p class="muted">No courses yet.</p>`)}
${actor.owner || actor.roles.has('author') ? h`<section class="card settings"><h2>New course</h2>${form('course.create', '/app/courses/{id}', [field('Title', 'title'), area('Summary', 'summary', '', false), select('Reviewer who publishes it', 'reviewer', reviewers.map(member => ({ value: member.id, label: member.name })))], 'Create course')}</section>` : ''}`
  return page('Courses', actor, body, { current: '/app/courses', url })
}

export async function coursePage(env: Bindings, actor: Actor, id: string, url: URL) {
  const [course, sources, names, assessors, window] = await Promise.all([courseDetail(env, actor, id), listSources(env, actor), memberNames(env), membersWithRole(env, 'assessor'), accessRule(env, 'course', id)])
  const zone = (await business(env))!.timezone
  const versions = sources.flatMap(source => source.versions.map((version: any) => ({ value: version.id, label: `${source.title} v${version.number}` })))
  const author = actor.owner || actor.roles.has('author')
  const draft = course.draft
  const base = [hidden('course', id), hidden('draftVersion', course.draftVersion)]
  const back = `/app/courses/${id}`
  const lessonForm = (lesson?: typeof draft.lessons[number]) => form('course.lesson', back, [...base, lesson ? hidden('lesson', lesson.id) : '', field('Lesson title', 'title', { value: lesson?.title ?? '' }), area('Lesson text', 'body', lesson?.body ?? ''), checks('Cites source versions', 'sources', versions, lesson?.sources ?? [])], lesson ? 'Save lesson' : 'Add lesson')
  const questionForm = (question?: typeof draft.questions[number]) => form('course.question', back, [...base, question ? hidden('question', question.id) : '', area('Question', 'prompt', question?.prompt ?? ''), area('Choices, one per line', 'choices', question?.choices.join('\n') ?? ''), field('Correct choice numbers', 'correct', { value: question ? question.correct.map(index => index + 1).join(',') : '', hint: 'For example 2, or 1,3 when several choices are correct.' })], question ? 'Save question' : 'Add question')
  const body = h`${backLink('/app/courses', 'Courses')}<h1>${course.title}</h1><p class="subtitle">Reviewer: ${names.get(course.reviewer)}${course.publishedRevision ? ' · has a published revision' : ''}</p>
${course.notices.filter((notice: any) => notice.state === 'open').map((notice: any) => h`<section class="card"><h2><mark class="hl">Source changed</mark></h2><p>“${notice.source_title}” moved from version ${notice.previous_number} to ${notice.new_number}. The published lessons cite version ${notice.previous_number}. Decide whether this changes the training.</p>${form('notice.decide', back, [hidden('notice', notice.id), select('Decision', 'decision', [{ value: 'no_material_change', label: 'No material change to the training' }, { value: 'draft_updated', label: 'Training needs updating (the draft is being revised)' }]), area('Reason', 'note')], 'Record decision')}</section>`)}
${course.proposals.filter((proposal: any) => proposal.state === 'open').map((proposal: any) => h`<section class="card"><h2>Proposed change</h2><p>${proposal.summary}</p><p class="muted">Prepared by ${names.get(proposal.preparedBy)}${proposal.agent ? ` using ${agentName(proposal.agent)}` : ''} from draft version ${proposal.baseDraftVersion}; inputs: ${proposal.inputs.length ? proposal.inputs.map((input: string) => versions.find(version => version.value === input)?.label ?? input).join(', ') : 'none named'}.</p>${proposal.passages.length ? h`<h3>Source passages it relies on</h3><ul>${proposal.passages.map((passage: any) => h`<li><q>${passage.quote}</q> <span class="muted">— ${versions.find(version => version.value === passage.sourceVersion)?.label ?? passage.sourceVersion}${passage.lesson ? `, for “${passage.lesson}”` : ''}</span></li>`)}</ul>` : ''}${proposal.missing.length ? h`<h3>Missing information</h3><ul>${proposal.missing.map((item: string) => h`<li>${item}</li>`)}</ul>` : ''}<details><summary>Proposed lessons</summary>${proposal.draft.lessons.map((lesson: any) => h`<h3>${lesson.title}</h3>${lessonText(lesson.body)}`)}</details>${form('proposal.decide', back, [hidden('proposal', proposal.id), hidden('decision', 'accept')], 'Apply to draft')}${form('proposal.decide', back, [hidden('proposal', proposal.id), hidden('decision', 'decline')], 'Decline', { secondary: true })}</section>`)}
<section class="card"><h2>Draft</h2>${author ? form('course.details', back, [...base, field('Title', 'title', { value: draft.title }), area('Summary', 'summary', draft.summary, false)], 'Save details') : h`<p>${draft.summary}</p>`}</section>
<section class="card"><h2>Lessons</h2>${draft.lessons.map((lesson, index) => h`<details><summary>${index + 1}. ${lesson.title}</summary>${author ? h`${lessonForm(lesson)}${form('course.lesson.move', back, [...base, hidden('lesson', lesson.id), hidden('direction', 'up')], 'Move up', { secondary: true })}${form('course.lesson.remove', back, [...base, hidden('lesson', lesson.id)], 'Remove lesson', { secondary: true })}` : lessonText(lesson.body)}</details>`)}${author ? h`<h3>Add a lesson</h3>${lessonForm()}` : ''}</section>
<section class="card"><h2>Quiz</h2>${draft.questions.map((question, index) => h`<details><summary>${index + 1}. ${question.prompt}</summary>${author ? h`${questionForm(question)}${form('course.question.remove', back, [...base, hidden('question', question.id)], 'Remove question', { secondary: true })}` : ''}</details>`)}${author ? h`<h3>Add a question</h3>${questionForm()}` : ''}</section>
${author ? h`<section class="card"><h2>Assessment rules</h2>${form('course.assessment', back, [...base, field('Pass mark (%)', 'passPercent', { type: 'number', value: draft.passPercent ?? '', required: false }), field('Quiz attempts allowed', 'maxAttempts', { type: 'number', value: draft.maxAttempts ?? '', required: false }), area('Practical assessment instructions (leave empty for none)', 'practicalInstructions', draft.practical?.instructions ?? '', false), select('Named assessor', 'assessor', assessors.map(member => ({ value: member.id, label: member.name })), draft.practical?.assessor ?? '', { required: false, blank: 'None' })], 'Save rules')}</section>
<section class="card"><h2>Send for review</h2><p>Freezes this draft as a new revision for ${names.get(course.reviewer)} to publish or return.</p>${form('course.submit', back, base, 'Submit for review')}</section>` : ''}
${card('Access window', h`<p>${describeRule(window)} A path’s window, or one set on an assignment, takes precedence; each new assignment takes its window when it is created.</p>${actor.owner ? windowForm('access.rule', back, [hidden('scope', 'course'), hidden('target', id)], window, 'Save window') : ''}`)}
${card('Revisions', course.revisions.length ? h`${rows(course.revisions.map((revision: any) => ({ title: h`<a href="/app/revisions/${revision.id}">Revision ${revision.number}</a>`, meta: `${state(revision.state)}, submitted ${when(revision.submittedAt, zone)} by ${names.get(revision.submittedBy)}${revision.reviewNote ? ` · note: ${revision.reviewNote}` : ''}`, aside: author ? form('course.restore', back, [...base, hidden('revision', revision.id)], 'Restore into draft', { secondary: true }) : '' })))}${course.revisions.length > 1 ? h`<h3>Compare revisions</h3>${compareForm(id, course.revisions)}` : ''}` : h`<p class="muted">No revisions yet.</p>`)}`
  return page(course.title, actor, body, { current: '/app/courses', url })
}

export async function revisionPage(env: Bindings, actor: Actor, id: string, url: URL) {
  requireRole(actor, 'author', 'reviewer', 'manager')
  const detail = await revisionDetail(env, id)
  const course = await courseDetail(env, actor, detail.revision.course_id).catch(() => { throw new BeamError('not_found', 404) })
  const names = await memberNames(env)
  const reviewer = actor.owner || course.reviewer === actor.id
  const body = h`${backLink(`/app/courses/${course.id}`, course.title)}<h1>${detail.revision.title} — revision ${detail.revision.number}</h1><p class="subtitle">${state(detail.revision.state)} · submitted by ${names.get(detail.revision.submitted_by)}</p>
${detail.lessons.map(lesson => h`<section class="card"><h2>${lesson.position + 1}. ${lesson.title}</h2>${lessonText(lesson.body)}</section>`)}
${detail.assessment ? h`<section class="card"><h2>Assessment</h2>${detail.assessment.questions.length ? h`<p>Quiz: ${detail.assessment.questions.length} ${detail.assessment.questions.length === 1 ? 'question' : 'questions'}, pass at ${detail.assessment.pass_percent}%${detail.assessment.max_attempts ? `, ${detail.assessment.max_attempts} ${detail.assessment.max_attempts === 1 ? 'attempt' : 'attempts'}` : ''}.</p><ol>${detail.assessment.questions.map(question => h`<li>${question.prompt}<ul>${question.choices.map((choice, index) => h`<li>${choice}${question.correct.includes(index) ? ' ✓' : ''}</li>`)}</ul></li>`)}</ol>` : ''}${detail.assessment.practical_instructions ? h`<p>Practical, assessed by ${names.get(detail.assessment.assessor_id)}:</p>${lessonText(detail.assessment.practical_instructions)}` : ''}</section>` : ''}
${detail.revision.state === 'in_review' && reviewer ? h`<section class="card"><h2>Review</h2>${form('revision.decide', `/app/revisions/${id}`, [hidden('revision', id), hidden('decision', 'publish'), select('When published', 'reassignment', [{ value: 'none', label: 'Keep current assignments on their revision' }, { value: 'open', label: 'Move open assignments to this revision' }, { value: 'everyone', label: 'Also reassign everyone who completed an earlier revision' }]), field('Days to complete a reassignment', 'dueDays', { type: 'number', value: 14 }), area('Note', 'note', '', false)], 'Publish this revision')}${form('revision.decide', `/app/revisions/${id}`, [hidden('revision', id), hidden('decision', 'return'), area('What needs changing', 'note')], 'Return to author', { secondary: true })}<p class="muted">Earlier completions stay bound to the revision they were made against.</p></section>` : ''}`
  return page(`Revision ${detail.revision.number}`, actor, body, { current: '/app/courses', url })
}
