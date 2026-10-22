import { packageEditor } from './packages'
import { courseLocaleCards } from './course-locales'
// Author and reviewer pages: sources, courses, the draft editor, revisions,
// source-change notices and proposals.
import { blockEditor } from './blocks'
import { renderBlocks, mediaPage } from './media'
import { embedPolicy } from '../media'
import { loadCourse } from '../courses'
import { collaboration } from '../collab'
import { contentQueue } from '../feedback'
import { lessonHash } from '../courses'
import { conflictsCard, queueCard, threadsFor } from './collab'
import { movePreview } from '../moves'
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { courseDetail, listCourses, revisionDetail } from '../courses'
import { BeamError, insist } from '../core'
import { business, memberNames, membersWithRole } from '../people'
import { listSources } from '../sources'
import { compareForm } from './history'
import { acknowledgmentList } from '../acknowledgments'
import { isManager } from '../actor'
import { all } from '../core'
import { enrollmentCard } from './catalog'
import { sourceAcknowledgments } from './acknowledgments'
import { surveyResults } from '../survey'
import { agentName, area, backLink, bytes, card, checks, field, fileField, form, h, hidden, lessonText, page, rows, select, when } from './html'
import { bankCard } from './bank'
import { KINDS as QUESTION_KINDS, answerText, formValues, kindOf, type Question } from '../question-types'

const KIND_LABELS: Record<typeof QUESTION_KINDS[number], string> = { choice: 'Multiple choice', blank: 'Fill in the blank', order: 'Ordering', match: 'Matching', text: 'Written answer' }
const FEEDBACK_LABELS: Record<string, string> = { attempt: 'After each attempt', final: 'Once they pass or have no attempts left', score: 'Never: show the score only' }
import { accessRule } from '../access'
import { describeRule, windowForm } from './access'
import { courseAccessCard } from './course-access'
import { upkeepCard } from './upkeep'
import { impactCard, noticeCard } from './impact'
import { noticeImpact } from '../impact'
import { courseUnits } from '../scope'

const LICENCES: Record<string, string> = { owned: 'owned', licensed: 'licensed to the business', permission: 'used with written permission' }
const STATES: Record<string, string> = { draft: 'draft', in_review: 'in review', published: 'published', superseded: 'superseded', returned: 'returned' }
const state = (value: string) => STATES[value] ?? value.replace(/_/g, ' ')
const KINDS: Record<string, string> = { 'application/pdf': 'PDF', 'text/plain': 'Text', 'text/markdown': 'Text', 'text/csv': 'CSV', 'image/png': 'PNG image', 'image/jpeg': 'JPEG image', 'video/mp4': 'MP4 video', 'audio/mpeg': 'MP3 audio', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel workbook' }
const fileKind = (mediaType: string) => KINDS[mediaType] ?? (mediaType.split('/')[1]?.split(/[.+;-]/)[0]?.toUpperCase() || 'File')

export async function sourcesPage(env: Bindings, actor: Actor, url: URL) {
  const [sources, reviewers, names, acknowledgments, teams] = await Promise.all([listSources(env, actor), membersWithRole(env, 'reviewer'), memberNames(env), acknowledgmentList(env, actor), isManager(actor) ? all(env, 'SELECT id, name FROM beam_teams WHERE (? IS NULL OR id IN (SELECT value FROM json_each(?))) ORDER BY name', actor.teams && JSON.stringify(actor.teams), actor.teams && JSON.stringify(actor.teams)) : []])
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

const staff = (actor: Actor) => actor.owner || ['author', 'reviewer', 'manager'].some(role => actor.roles.has(role as never))

export async function coursesPage(env: Bindings, actor: Actor, url: URL) {
  // A learning administrator sees and creates only their units' courses (ORG-002).
  if (!staff(actor)) insist(courseUnits(actor).length || actor.authorOf.length, 'forbidden', 403)
  const [courses, reviewers, units] = await Promise.all([listCourses(env, staff(actor) ? null : { units: courseUnits(actor), courses: actor.authorOf }), membersWithRole(env, 'reviewer'), all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_units ORDER BY name')])
  const author = actor.owner || actor.roles.has('author')
  const unitOptions = units.filter(unit => author || courseUnits(actor).includes(unit.id)).map(unit => ({ value: unit.id, label: unit.name }))
  // AUTHOR-005: filter by folder and tag; archived courses only when asked for.
  const folder = url.searchParams.get('folder') ?? '', tag = url.searchParams.get('tag') ?? '', archived = url.searchParams.get('archived') === '1'
  const shown = courses.filter(course => (archived ? course.archivedAt : !course.archivedAt) && (!folder || course.folder === folder) && (!tag || course.tags.includes(tag)))
  const folders = [...new Set(courses.map(course => course.folder).filter(Boolean))].sort().map(value => ({ value, label: value }))
  const tags = [...new Set(courses.flatMap(course => course.tags))].sort().map(value => ({ value, label: value }))
  const catalog = actor.owner || courseUnits(actor).length > 0
  const templates = courses.filter(course => course.template && !course.retiredAt).map(course => ({ value: course.id, label: course.title }))
  const filters = h`<form class="card filters" method="get" action="/app/courses"><div>${select('Folder', 'folder', folders, folder, { required: false, blank: 'Every folder' })}</div><div>${select('Tag', 'tag', tags, tag, { required: false, blank: 'Every tag' })}</div><label class="check"><input type="checkbox" name="archived" value="1"${archived ? h` checked` : ''}> Archived courses</label><div class="filter-actions"><button type="submit">Show</button></div></form>`
  // AUTHOR-003: the content queue of learner feedback on the courses this person looks after.
  const queue = queueCard(await contentQueue(env, actor), (await business(env))!.timezone, '/app/courses')
  const body = h`<h1>Courses</h1>${actor.owner || actor.grants.certificates ? h`<p><a href="/app/certificate-templates">Certificate templates</a></p>` : ''}${queue}${filters}${card(archived ? 'Archived courses' : 'Course list', shown.length ? rows(shown.map(course => ({ title: course.title, meta: `${course.publishedNumber ? `published revision ${course.publishedNumber}` : 'not published'}${course.inReview ? ' · revision in review' : ''}${course.retiredAt ? ' · retired' : ''}${course.template ? ' · template' : ''}${course.folder ? ` · ${course.folder}` : ''}${course.tags.length ? ` · ${course.tags.join(', ')}` : ''}`, href: `/app/courses/${course.id}` }))) : h`<p class="muted">No courses here.</p>`)}
${catalog && shown.length ? card('Change tags on several courses', form('course.retag', `/app/courses${url.search}`, [checks('Courses', 'courses', shown.map(course => ({ value: course.id, label: course.title })), [], { scroll: true }), field('Add tags (comma separated)', 'add', { required: false }), field('Remove tags (comma separated)', 'remove', { required: false })], 'Change tags')) : ''}
${(author || catalog) && templates.length ? card('Start from a template', form('course.clone', '/app/courses/{id}', [select('Template', 'course', templates), field('Title', 'title', { required: false })], 'Create from template')) : ''}
${author || courseUnits(actor).length ? h`<section class="card settings"><h2>New course</h2>${form('course.create', '/app/courses/{id}', [field('Title', 'title'), area('Summary', 'summary', '', false), select('Reviewer who publishes it', 'reviewer', reviewers.map(member => ({ value: member.id, label: member.name }))), unitOptions.length ? select('Business unit', 'unit', unitOptions, '', author ? { required: false, blank: 'No unit' } : {}) : ''], 'Create course')}</section>` : ''}`
  return page('Courses', actor, body, { current: '/app/courses', url })
}

// AUTHOR-005: whoever manages the course's catalog retires it with a reason, reinstates it, or copies it into a new
// unpublished course. A retired course keeps its records and open assignments and is never assigned anew.
/** AUTHOR-005: the course's catalog details, editable by whoever manages its catalog. */
function catalogCard(id: string, course: Awaited<ReturnType<typeof courseDetail>>, catalog: boolean, people: { value: string; label: string }[], names: Map<string, string>) {
  const details = course.catalog
  if (!catalog) return details.folder || details.tags.length || details.objectives.length ? card('Catalog', h`<p class="muted">${[details.folder, details.tags.join(', '), details.durationMinutes ? `${details.durationMinutes} minutes` : '', details.owner ? `owner ${names.get(details.owner)}` : ''].filter(Boolean).join(' · ')}</p>${details.objectives.length ? h`<ul>${details.objectives.map(line => h`<li>${line}</li>`)}</ul>` : ''}`) : ''
  return card('Catalog details', form('course.catalog', `/app/courses/${id}`, [hidden('course', id), field('Folder', 'folder', { value: details.folder ?? '', required: false }), field('Tags (comma separated)', 'tags', { value: details.tags.join(', '), required: false }), area('Learning objectives, one per line', 'objectives', details.objectives.join('\n'), false), field('Language', 'language', { value: details.language, hint: 'A language code such as en or es-US.' }), field('Expected duration in minutes', 'durationMinutes', { type: 'number', value: details.durationMinutes ?? '', required: false }), select('Course owner', 'owner', people, details.owner ?? '', { required: false, blank: 'No owner' }), checks('Reuse', 'template', [{ value: 'true', label: 'Offer this course as a template for new courses' }], details.template ? ['true'] : [])], 'Save catalog details'))
}

function estateCard(id: string, course: Awaited<ReturnType<typeof courseDetail>>, catalog: boolean, names: Map<string, string>, zone: string) {
  const back = `/app/courses/${id}`
  const retired = course.retired ? h`<p class="flash" role="status">Retired ${when(course.retired.at, zone)} by ${names.get(course.retired.by) ?? 'someone'}: ${course.retired.reason} Its records and open assignments stay; nobody can assign it anew.</p>` : ''
  if (!catalog) return retired ? card('Retired', retired) : ''
  const archive = course.retired ? form('course.archive', back, [hidden('course', id), hidden('archived', course.catalog.archivedAt ? 'false' : 'true')], course.catalog.archivedAt ? 'Take out of the archive' : 'Archive', { secondary: true }) : ''
  return card(course.retired ? 'Retired' : 'Retire or copy', h`${retired}${course.retired ? h`${form('course.reinstate', back, [hidden('course', id)], 'Reinstate for new assignments', { secondary: true })}${archive}` : h`<details><summary>Retire this course</summary>${form('course.retire', back, [hidden('course', id), area('Reason', 'reason')], 'Retire', { secondary: true })}</details>`}<details><summary>Copy into a new course</summary>${form('course.clone', '/app/courses/{id}', [hidden('course', id), field('Title of the copy', 'title', { value: `Copy of ${course.title}`, required: false })], 'Make a copy', { secondary: true })}</details>`)
}

export async function coursePage(env: Bindings, actor: Actor, id: string, url: URL) {
  const course = await courseDetail(env, actor, id)
  // Sources stay with staff: a learning administrator writes lessons without citing the library.
  const [sources, names, assessors, window, units] = await Promise.all([staff(actor) ? listSources(env, actor) : [], memberNames(env), membersWithRole(env, 'assessor'), accessRule(env, 'course', id), actor.owner ? all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_units ORDER BY name') : []])
  const zone = (await business(env))!.timezone
  const versions = sources.flatMap(source => source.versions.map((version: any) => ({ value: version.id, label: `${source.title} v${version.number}` })))
  const citedIds = [...new Set(course.draft.lessons.flatMap(lesson => lesson.sources))]
  if (!sources.length && citedIds.length) versions.push(...(await all<{ value: string; label: string }>(env, `SELECT v.id AS value, s.title || ' v' || v.number AS label FROM beam_source_versions v JOIN beam_sources s ON s.id = v.source_id WHERE v.id IN (SELECT value FROM json_each(?)) ORDER BY s.title, v.number`, JSON.stringify(citedIds))))
  const author = actor.owner || actor.roles.has('author') || courseUnits(actor).includes(course.unit) || actor.authorOf.includes(id)
  const draft = course.draft
  const policy = await embedPolicy(env)
  if (url.searchParams.get('preview') === 'learner') {
    return mediaPage(env, page(`Preview: ${course.title}`, actor, h`${backLink(`/app/courses/${id}`, 'Back to editor')}<h1>${draft.title}</h1><p class="flash">Learner preview · draft version ${course.draftVersion}. This preview does not record training.</p><p>${draft.summary}</p>${draft.lessons.map(lesson => h`<article class="card lesson-card"><h2>${lesson.title}</h2><div class="lesson-body">${lessonText(lesson.body, { lead: true })}${renderBlocks(lesson.blocks, policy.hosts)}</div></article>`)}`, { current: '/app/courses', url }))
  }
  const reusable: { value: string; label: string }[] = []
  if (author) {
    const available = await listCourses(env, actor.owner || actor.roles.has('author') ? null : { units: courseUnits(actor), courses: actor.authorOf })
    for (const item of available) {
      const source = await loadCourse(env, item.id)
      for (const lesson of source.draft.lessons) for (const block of lesson.blocks ?? []) if (block.kind !== 'lti') reusable.push({ value: `${item.id}:${lesson.id}:${block.id}`, label: `${item.title} / ${lesson.title} / ${block.text.slice(0, 60)}` })
    }
  }
  const base = [hidden('course', id), hidden('draftVersion', course.draftVersion)]
  const back = `/app/courses/${id}`
  // AUTHOR-003: each lesson form carries the lesson as its editor saw it; conflicts, threads and learner feedback.
  const hashes = new Map(await Promise.all(draft.lessons.map(async lesson => [lesson.id, await lessonHash(lesson)] as const)))
  const collab = await collaboration(env, actor, id).catch(() => null)
  const threads = (kind: 'lesson' | 'question', target: string) => collab ? threadsFor(collab.threads, id, kind, target, zone) : ''
  const feedback = queueCard(await contentQueue(env, actor, id), zone, back, 'Learner feedback on this course')
  const lessonForm = (lesson?: typeof draft.lessons[number]) => form('course.lesson', back, [...base, lesson ? h`${hidden('lesson', lesson.id)}${hidden('base', hashes.get(lesson.id))}` : '', field('Lesson title', 'title', { value: lesson?.title ?? '' }), area('Lesson text', 'body', lesson?.body ?? ''), checks('Cites source versions', 'sources', versions, lesson?.sources ?? [])], lesson ? 'Save lesson' : 'Add lesson')
  // LEARN-015: each question type has its own answer fields; the learner never sees them.
  const answerFields = (kind: typeof QUESTION_KINDS[number], question?: Question) => {
    const values: Record<string, any> = question ? formValues(question) : {}
    if (kind === 'text') return [area('Guidance for the assessor (learners never see it)', 'guidance', values.guidance ?? '', false)]
    if (kind === 'blank') return [area('Accepted answers: one line per blank, alternatives separated by |', 'answers', values.answers ?? ''), checks('Comparing answers', 'ignoreCase', [{ value: '1', label: 'Ignore upper and lower case (spaces at either end are always ignored)' }], values.ignoreCase ? ['1'] : [])]
    if (kind === 'order') return [area('Items in the correct order, one per line', 'items', values.items ?? '')]
    if (kind === 'match') return [area('Pairs, one per line as left = right', 'pairs', values.pairs ?? '')]
    return [area('Choices, one per line', 'choices', values.choices ?? ''), field('Correct choice numbers', 'correct', { value: values.correct ?? '', hint: 'For example 2, or 1,3 when several choices are correct.' })]
  }
  const questionForm = (kind: typeof QUESTION_KINDS[number], question?: Question) => form('course.question', back, [...base, hidden('kind', kind), question ? hidden('question', question.id) : '', area('Question', 'prompt', question?.prompt ?? ''), ...answerFields(kind, question), field('Points (its weight in the score)', 'points', { type: 'number', value: question ? formValues(question).points : 1, required: false }), checks('When drawing', 'always', [{ value: '1', label: 'Always ask this question' }], question?.always ? ['1'] : [])], question ? 'Save question' : 'Add question')
  // AGENT-004: the owner, the course's authors and its named reviewer see what each open source change affects.
  const decides = actor.owner || (actor.roles.has('reviewer') && course.reviewer === actor.id)
  const impacts = await Promise.all(course.notices.filter((notice: any) => notice.state === 'open').map(async (notice: any) => ({ notice, impact: author || decides ? await noticeImpact(env, actor, notice.id) : null })))
  const body = h`${backLink('/app/courses', 'Courses')}<h1>${course.title}</h1><p class="subtitle">Reviewer: ${names.get(course.reviewer)}${course.publishedRevision ? ' · has a published revision' : ''}</p>
${impacts.map(({ notice, impact }) => impact ? impactCard(impact, back, { author, decides }) : noticeCard(notice, back))}
${course.proposals.filter((proposal: any) => proposal.state === 'open').map((proposal: any) => h`<section class="card"><h2>Proposed change</h2><p>${proposal.summary}</p><p class="muted">Prepared by ${names.get(proposal.preparedBy)}${proposal.agent ? ` using ${agentName(proposal.agent)}` : ''} from draft version ${proposal.baseDraftVersion}; inputs: ${proposal.inputs.length ? proposal.inputs.map((input: string) => versions.find(version => version.value === input)?.label ?? input).join(', ') : 'none named'}.</p>${proposal.passages.length ? h`<h3>Source passages it relies on</h3><ul>${proposal.passages.map((passage: any) => h`<li><q>${passage.quote}</q> <span class="muted">— ${versions.find(version => version.value === passage.sourceVersion)?.label ?? passage.sourceVersion}${passage.lesson ? `, for “${passage.lesson}”` : ''}</span></li>`)}</ul>` : ''}${proposal.missing.length ? h`<h3>Missing information</h3><ul>${proposal.missing.map((item: string) => h`<li>${item}</li>`)}</ul>` : ''}<details><summary>Proposed lessons</summary>${proposal.draft.lessons.map((lesson: any) => h`<h3>${lesson.title}</h3>${lessonText(lesson.body)}${renderBlocks(lesson.blocks, policy.hosts)}`)}</details>${form('proposal.decide', back, [hidden('proposal', proposal.id), hidden('decision', 'accept')], 'Apply to draft')}${form('proposal.decide', back, [hidden('proposal', proposal.id), hidden('decision', 'decline')], 'Decline', { secondary: true })}</section>`)}
${await packageEditor(env, actor, course, versions, author)}${author ? await courseLocaleCards(env, actor, id) : ''}${catalogCard(id, course, actor.owner || courseUnits(actor).includes(course.unit), [...names].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)), names)}${actor.owner || courseUnits(actor).includes(course.unit) ? enrollmentCard(id, course.catalog, await all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_teams ORDER BY name')) : ''}${estateCard(id, course, actor.owner || courseUnits(actor).includes(course.unit), names, zone)}${upkeepCard(actor, course, actor.owner || courseUnits(actor).includes(course.unit), [...names].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)), names, zone)}${collab ? conflictsCard(collab.conflicts, id, course.draftVersion, zone) : ''}${feedback}<p><a class="button secondary" href="/app/courses/${id}?preview=learner">Preview as learner</a></p><section class="card"><h2>Draft</h2>${author ? form('course.details', back, [...base, field('Title', 'title', { value: draft.title }), area('Summary', 'summary', draft.summary, false)], 'Save details') : h`<p>${draft.summary}</p>`}</section>
<section class="card"><h2>Lessons</h2>${draft.lessons.map((lesson, index) => h`<details><summary>${index + 1}. ${lesson.title}</summary>${author ? h`${lessonForm(lesson)}${blockEditor(id, course.draftVersion, lesson.id, lesson.blocks ?? [], versions, reusable)}${form('course.lesson.move', back, [...base, hidden('lesson', lesson.id), hidden('direction', 'up')], 'Move up', { secondary: true })}${form('course.lesson.remove', back, [...base, hidden('lesson', lesson.id)], 'Remove lesson', { secondary: true })}` : lessonText(lesson.body)}${threads('lesson', lesson.id)}</details>`)}${author ? h`<h3>Add a lesson</h3>${lessonForm()}` : ''}</section>
<section class="card"><h2>Question bank</h2><p class="muted">${draft.drawCount ? `Each attempt draws ${draft.drawCount} of these ${draft.questions.length} questions at random` : `Each attempt asks all ${draft.questions.length} questions`}${draft.shuffle ? ', in a shuffled order' : ''}.</p>${draft.questions.map((question, index) => h`<details><summary>${index + 1}. ${question.prompt} <span class="muted">· ${KIND_LABELS[kindOf(question)]} · ${question.points ?? 1} ${(question.points ?? 1) === 1 ? 'point' : 'points'}${question.always ? ' · always asked' : ''}</span></summary>${author ? h`${questionForm(kindOf(question), question)}${form('course.question.remove', back, [...base, hidden('question', question.id)], 'Remove question', { secondary: true })}` : ''}${threads('question', question.id)}</details>`)}${author ? bankCard(id) : ''}${author ? h`<h3>Add a question</h3>${QUESTION_KINDS.map(kind => h`<details><summary>${KIND_LABELS[kind]}</summary>${questionForm(kind)}</details>`)}` : ''}</section>
${author ? h`<section class="card"><h2>Assessment rules</h2>${form('course.assessment', back, [...base, field('Pass mark (%)', 'passPercent', { type: 'number', value: draft.passPercent ?? '', required: false }), field('Quiz attempts allowed', 'maxAttempts', { type: 'number', value: draft.maxAttempts ?? '', required: false }), field('Time limit in minutes (leave empty for none)', 'timeLimitMinutes', { type: 'number', value: draft.timeLimitMinutes ?? '', required: false }), field('Questions drawn per attempt (leave empty to ask every question)', 'drawCount', { type: 'number', value: draft.drawCount ?? '', required: false }), checks('Order', 'shuffle', [{ value: '1', label: 'Shuffle the order for each attempt' }], draft.shuffle ? ['1'] : []), select('Learners see which answers were right', 'feedback', Object.entries(FEEDBACK_LABELS).map(([value, label]) => ({ value, label })), draft.feedback ?? 'attempt'), area('Practical assessment instructions (leave empty for none)', 'practicalInstructions', draft.practical?.instructions ?? '', false), select('Named assessor (grades written answers and practical evidence)', 'assessor', assessors.map(member => ({ value: member.id, label: member.name })), draft.practical?.assessor ?? draft.assessor ?? '', { required: false, blank: 'None' })], 'Save rules')}${form('course.attendance', back, [...base, field('Session attendance required (% of the session’s scheduled minutes; leave empty for none)', 'attendancePercent', { type: 'number', value: draft.attendancePercent ?? '', required: false })], 'Save attendance rule', { secondary: true })}</section>
<section class="card"><h2>Satisfaction survey</h2><p class="muted">Optional for learners and never part of passing or completion.</p>${form('course.survey', back, [...base, area('Survey questions, one per line; start a line with “rating:” to ask for a rating from 1 to 5', 'survey', (draft.survey ?? []).map(item => `${item.kind === 'rating' ? 'rating: ' : ''}${item.prompt}`).join('\n'), false)], 'Save survey', { secondary: true })}</section>
<section class="card"><h2>Send for review</h2><p>Freezes this draft as a new revision for ${names.get(course.reviewer)} to publish or return.</p>${form('course.submit', back, base, 'Submit for review')}</section>` : ''}
${await courseAccessCard(env, actor, course, names, zone)}
${actor.owner && units.length ? card('Business unit', form('course.unit', back, [hidden('course', id), select('Business unit', 'unit', units.map(unit => ({ value: unit.id, label: unit.name })), course.unit ?? '', { required: false, blank: 'No unit' })], 'Save unit')) : ''}
${card('Access window', h`<p>${describeRule(window)} A path’s window, or one set on an assignment, takes precedence; each new assignment takes its window when it is created.</p>${actor.owner ? windowForm('access.rule', back, [hidden('scope', 'course'), hidden('target', id)], window, 'Save window') : ''}`)}
${actor.owner ? card('Web content allowlist', h`<p>Only HTTPS frames from these exact hosts can appear in lessons. Use embed URLs for Microsoft 365 and other web content. Removing a host disables its frames in existing lessons too.</p>${form('embed.policy', back, [hidden('version', policy.version), area('Allowed embed hosts, one per line', 'hosts', policy.hosts.join('\n'), false)], 'Save embed allowlist')}`) : ''}
${card('Revisions', course.revisions.length ? h`${rows(course.revisions.map((revision: any) => ({ title: h`<a href="/app/revisions/${revision.id}">Revision ${revision.number}</a>`, meta: `${state(revision.state)}, submitted ${when(revision.submittedAt, zone)} by ${names.get(revision.submittedBy)}${revision.reviewedBy ? ` · decided by ${names.get(revision.reviewedBy)}${revision.selfReviewed ? ' (self-reviewed)' : ''}` : ''}${revision.reviewNote ? ` · note: ${revision.reviewNote}` : ''}`, aside: author ? form('course.restore', back, [...base, hidden('revision', revision.id)], 'Restore into draft', { secondary: true }) : '' })))}${course.revisions.length > 1 ? h`<h3>Compare revisions</h3>${compareForm(id, course.revisions)}` : ''}` : h`<p class="muted">No revisions yet.</p>`)}`
  return mediaPage(env, page(course.title, actor, body, { current: '/app/courses', url }))
}

export async function revisionPage(env: Bindings, actor: Actor, id: string, url: URL) {
  if (!staff(actor)) insist(courseUnits(actor).length || actor.authorOf.length, 'forbidden', 403)
  const detail = await revisionDetail(env, id)
  const course = await courseDetail(env, actor, detail.revision.course_id).catch(() => { throw new BeamError('not_found', 404) })
  const names = await memberNames(env)
  const policy = await embedPolicy(env)
  const reviewer = actor.owner || course.reviewer === actor.id
  // AUTHOR-010: before publishing, who would move to this revision, what each keeps or reopens, and who has finished.
  const preview = detail.revision.state === 'in_review' && reviewer ? await movePreview(env, actor, id) : null
  const ASSESSMENT_FATE: Record<string, string> = { unchanged: 'assessment unchanged: attempts carry over', changed: 'assessment changed: earlier attempts no longer count', none: 'no assessment' }
  const previewCard = preview ? card('If you move open assignments', h`${preview.moves.length ? rows(preview.moves.map(move => ({ title: `${move.learnerName} (from revision ${move.fromRevision})`,
    meta: `Keeps ${move.kept.length ? move.kept.join(', ') : 'no lessons'} · reopens ${move.reopened.length ? move.reopened.join(', ') : 'nothing'} · ${ASSESSMENT_FATE[move.assessment]}${move.attemptsCarried ? `, ${move.attemptsCarried} carried` : ''}${move.attemptsVoided ? `, ${move.attemptsVoided} unfinished voided` : ''}` }))) : h`<p class="muted">No open assignment is on an earlier revision.</p>`}
${preview.finished.length ? h`<p>Finished an earlier revision (a new assignment only if you also reassign them, which marks the change material; their completions and certificates stay): ${preview.finished.map(row => row.learnerName).join(', ')}.</p>` : ''}`, { id: 'move-preview' }) : ''
  const body = h`${backLink(`/app/courses/${course.id}`, course.title)}<h1>${detail.revision.title} — revision ${detail.revision.number}</h1><p class="subtitle">${state(detail.revision.state)} · submitted by ${names.get(detail.revision.submitted_by)}${detail.revision.reviewed_by ? ` · decided by ${names.get(detail.revision.reviewed_by)}${detail.revision.self_reviewed ? ' (self-reviewed)' : ''}` : ''}</p>
${detail.packages.map(pkg => card(pkg.title, h`<p>SCORM ${pkg.standard} · exact immutable package revision</p>${pkg.manifest.scos.map(sco => form('package.launch', '/app/packages/play/{id}', [hidden('package', pkg.id), hidden('sco', sco.id), hidden('preview', 'true')], `Preview ${sco.title}`, { secondary: true }))}`))}
${detail.lessons.map(lesson => h`<section class="card"><h2>${lesson.position + 1}. ${lesson.title}</h2>${lessonText(lesson.body)}${renderBlocks(lesson.blocks, policy.hosts)}</section>`)}
${detail.revision.attendance_percent ? h`<section class="card"><h2>Session attendance</h2><p>Learners must also attend a session of this course: at least ${detail.revision.attendance_percent}% of its scheduled minutes, with a completed decision on the roster. Lessons and the assessment are still required.</p></section>` : ''}${detail.assessment ? h`<section class="card"><h2>Assessment</h2>${detail.assessment.questions.length ? h`<p>Quiz: ${detail.assessment.draw_count ? `${detail.assessment.draw_count} drawn at random from a bank of ` : ''}${detail.assessment.questions.length} ${detail.assessment.questions.length === 1 ? 'question' : 'questions'}${detail.assessment.shuffle ? ', shuffled' : ''}, pass at ${detail.assessment.pass_percent}%${detail.assessment.max_attempts ? `, ${detail.assessment.max_attempts} ${detail.assessment.max_attempts === 1 ? 'attempt' : 'attempts'}` : ''}${detail.assessment.time_limit_minutes ? `, ${detail.assessment.time_limit_minutes} minutes` : ''}; learners see which answers were right: ${(FEEDBACK_LABELS[detail.assessment.feedback] ?? FEEDBACK_LABELS.attempt).toLowerCase()}${detail.assessment.assessor_id ? `; ${names.get(detail.assessment.assessor_id)} grades written answers` : ''}.</p><ol>${detail.assessment.questions.map(question => h`<li>${question.prompt}<ul>${answerText(question).split('\n').map(line => h`<li>${line}</li>`)}</ul></li>`)}</ol>` : ''}${detail.assessment.practical_instructions ? h`<p>Practical, assessed by ${names.get(detail.assessment.assessor_id)}:</p>${lessonText(detail.assessment.practical_instructions)}` : ''}</section>` : ''}${detail.survey.length ? await surveyCard(env, actor, id) : ''}
${previewCard}${detail.revision.state === 'in_review' && reviewer ? h`<section class="card"><h2>Review</h2>${form('revision.decide', `/app/revisions/${id}`, [hidden('revision', id), hidden('decision', 'publish'), select('When published', 'reassignment', [{ value: 'none', label: 'Keep current assignments on their revision' }, { value: 'open', label: 'Move open assignments to this revision, keeping unchanged progress' }, { value: 'everyone', label: 'Move open assignments and reassign everyone who completed an earlier revision (a material change)' }]), field('Days to complete a reassignment', 'dueDays', { type: 'number', value: 14 }), area('Note', 'note', '', false)], 'Publish this revision')}${form('revision.decide', `/app/revisions/${id}`, [hidden('revision', id), hidden('decision', 'return'), area('What needs changing', 'note')], 'Return to author', { secondary: true })}<p class="muted">Earlier completions stay bound to the revision they were made against.</p></section>` : ''}`
  return mediaPage(env, page(`Revision ${detail.revision.number}`, actor, body, { current: '/app/courses', url }))
}

/** LEARN-001: the revision's survey and, once enough learners answered, its results without names. */
async function surveyCard(env: Bindings, actor: Actor, revision: string) {
  const results = await surveyResults(env, actor, revision).catch(() => null)
  if (!results) return ''
  const shown = results.hidden === null
  return h`<section class="card"><h2>Satisfaction survey</h2><p class="muted">Not part of passing or completion. ${results.answers} ${results.answers === 1 ? 'answer' : 'answers'}${shown ? ', shown without names in no particular order' : `; results show once at least ${results.minimumAnswers} learners answer`}.</p><ol>${results.questions.map((item: any) => h`<li>${item.prompt}${item.kind === 'rating' ? ' (rating 1 to 5)' : ''}${item.ratings ? h`<p class="muted">${item.ratings.map((count: number, index: number) => `${index + 1}: ${count}`).join(' · ')}</p>` : ''}${item.texts ? h`<ul>${item.texts.map((text: string) => h`<li>${text}</li>`)}</ul>` : ''}</li>`)}</ol></section>`
}
