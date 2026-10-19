// Learner pages: my learning, lessons with resume, quiz, practical evidence,
// certificates and a learner's record.
import type { Bindings } from '../../auth.server'
import { requireAccess } from '../access'
import type { Actor } from '../actor'
import { accessBanner, accessCard, accessNote } from './access'
import { accommodationCard, accommodationLabel, questionFields, timedQuiz, timedStart } from './timing'
import { accommodations } from '../timing'
import { listCourses } from '../courses'
import { all, BeamError } from '../core'
import { listProposals } from '../agent-work'
import { assignmentView } from '../learning'
import { acknowledgmentList } from '../acknowledgments'
import { acknowledgmentCard } from './acknowledgments'
import { reminderMessages } from '../plans'
import { scenariosFor } from '../practice'
import { myQuestions } from '../questions'
import { announcements } from '../announcements'
import { receivedCard } from './announcements'
import { business, memberNames } from '../people'
import { certificate, learnerRecord, queues, reminders } from '../records'
import { formatDate } from '../time'
import branding from '../../branding.json'
import { formatDay } from '../time'
import { bookStack, documentSheet } from './drawings'
import { area, backLink, card, cellLabel, field, lessonCount, fileField, form, h, hidden, lessonText, page, pill, progress, raw, rows, when, type Html } from './html'
import { icon } from './icons'

const STATUS: Record<string, string> = { open: 'Open', completed: 'Completed', expiring: 'Expiring', overdue: 'Overdue', cancelled: 'Canceled', replaced: 'Replaced' }
const statusLabel = (row: any) => row.state === 'overdue' ? `Overdue, ${row.daysOverdue} ${row.daysOverdue === 1 ? 'day' : 'days'}` : STATUS[row.state] ?? row.state
const METHOD: Record<string, string> = { lessons: 'lessons', assessed: 'lessons and assessment', offline: 'attested offline training' }
const attemptState = (state: string) => ({ awaiting_review: 'waiting for the assessor', accepted: 'accepted', rejected: 'returned for resubmission' } as Record<string, string>)[state] ?? state.replace(/_/g, ' ')
const day = formatDay

export async function dashboard(env: Bindings, actor: Actor, url: URL) {
  const zone = (await business(env))!.timezone
  const preparer = actor.owner || ['author', 'reviewer', 'manager'].some(role => actor.roles.has(role as never))
  const [record, due, work, messages, asked, proposals, acknowledgments, notices] = await Promise.all([learnerRecord(env, actor, actor.id), reminders(env, actor), queues(env, actor), reminderMessages(env, actor), myQuestions(env, actor), preparer ? listProposals(env, actor) : [], acknowledgmentList(env, actor), announcements(env, actor)])
  const decidable = proposals.filter(proposal => proposal.canDecide).length
  const open = record.assignments.filter(row => row.status === 'open')
  const reminderCard = due.length || messages.length ? card('Reminders', h`${rows([
    ...due.map(row => ({ title: row.courseTitle, meta: `${row.kind === 'overdue' ? 'Overdue since' : 'Due'} ${when(row.dueAt, row.timezone, zone)}`, href: `/app/learn/${row.id}` })),
    ...messages.map(row => ({ title: row.courseTitle, meta: h`Message from ${row.approvedBy}: ${row.body}`, href: `/app/learn/${row.assignment}` })),
  ])}<p class="muted foot-note">Training that is part of your work is done in paid working time.</p>`, { id: 'reminders' }) : ''
  // Anonymous questions stay the learner's own (BEAM-19): a read-only view (ORG-012) does not list them.
  const asks = asked.length && !actor.viewAs ? card('Questions for you', rows(asked.map(row => ({ title: row.title, meta: `Optional · closes ${day(row.closesOn)}`, href: `/app/questions/${row.id}` }))), { id: 'asked' }) : ''
  const agent = decidable ? card('Agent work', h`<p><a href="/app/agent">${decidable} ${decidable === 1 ? 'proposal is' : 'proposals are'} waiting for your decision</a></p>`, { id: 'agent' }) : ''
  const review = work.reviews.length || work.notices.length ? card('Waiting for my review', rows([
    ...work.reviews.map(row => ({ title: `${row.title} revision ${row.number}`, href: `/app/revisions/${row.id}` })),
    ...work.notices.map(row => ({ title: row.courseTitle, meta: h`Source “${row.sourceTitle}” has a new version`, href: `/app/courses/${row.course}` })),
  ]), { id: 'review' }) : ''
  const assess = work.assessments.length ? card('Practical evidence to assess', rows(work.assessments.map(row => ({ title: `${row.learnerName} — ${row.courseTitle}`, href: `/app/attempts/${row.id}` }))), { id: 'assess' }) : ''
  const assigned = card('Assigned to me', open.length ? rows(open.map(row => ({ title: row.courseTitle, meta: [`revision ${row.revisionNumber}`, lessonCount(row.lessonsDone, row.lessonsTotal), `due ${when(row.dueAt, row.timezone, zone)}`, accessNote({ state: row.access, opensAt: row.accessOpensAt, closesAt: row.accessClosesAt }, zone)].filter(Boolean).join(' · '), aside: progress(row.lessonsDone, row.lessonsTotal), href: `/app/learn/${row.id}` }))) : h`<p>Nothing is assigned to you right now.</p>${raw(bookStack)}`, { id: 'assigned', className: open.length ? '' : 'empty' })
  const completed = card('Completed', record.completions.length ? rows(record.completions.map(row => ({ title: `${row.courseTitle} (revision ${row.revisionNumber})`, meta: h`${formatDate(row.completedAt, zone)}${row.expiresAt ? h` · renew by ${formatDate(row.expiresAt, zone)}` : ''} · <a href="/app/certificates/${row.certificate}">Certificate</a>` }))) : h`<p>No completions yet.</p>${raw(documentSheet)}`, { id: 'done', className: record.completions.length ? '' : 'empty' })
  const side = [review, assess].filter(Boolean)
  const body = h`<h1>My learning</h1>
${reminderCard}${receivedCard(notices.received, actor, zone)}${acknowledgmentCard(acknowledgments.mine)}${asks}${agent}
${open.length ? assigned : ''}
<div class="grid">${open.length ? '' : assigned}${completed}${side}</div>`
  return page('My learning', actor, body, { current: '/app/learning', url })
}

export async function learnOverview(env: Bindings, actor: Actor, id: string, url: URL) {
  const view = await assignmentView(env, actor, id)
  const names = await memberNames(env)
  const zone = (await business(env))!.timezone
  const a = view.assignment
  const launchable = a.status === 'open' && view.access.state === 'open'
  const resume = view.resumeLesson ? `/app/learn/${id}/lessons/${view.resumeLesson}` : null
  // Practice is private to the learner: a read-only view (ORG-012) does not list it.
  const practice = a.learner === actor.id && !actor.viewAs ? await scenariosFor(env, a.revision) : []
  const lessons = card('Lessons', h`<ol class="rows numbered">${view.lessons.map(lesson => h`<li><a class="row row-link" href="/app/learn/${id}/lessons/${lesson.id}"><span class="row-text"><span class="row-title">${lesson.title}</span></span>${lesson.completed ? h`<span class="tag done">done</span>` : ''}${raw(icon('chevron', { size: 20, className: 'chevron' }))}</a></li>`)}</ol>`)
  const timeLimit = view.quiz?.timeLimitMinutes ? ` Time limit ${view.quiz.timeLimitMinutes} minutes${view.quiz.extraMinutes ? `, plus ${view.quiz.extraMinutes} minutes extra time (${accommodationLabel(view.quiz.accommodation!)})` : ''}.` : ''
  const quiz = view.quiz ? card('Quiz', h`<p>Pass mark ${view.quiz.passPercent}%. ${view.quiz.passed ? 'Passed.' : `${view.quiz.attemptsLeft} attempt${view.quiz.attemptsLeft === 1 ? '' : 's'} left.`}${timeLimit}</p>${!view.quiz.passed && launchable && a.learner === actor.id ? (view.lessonsComplete ? h`<a class="button" href="/app/learn/${id}/quiz">${view.quiz.session ? 'Return to the timed quiz' : 'Take the quiz'}</a>` : h`<p class="muted">Available after every lesson is done.</p>`) : ''}`) : ''
  const practical = view.practical ? card('Practical assessment', h`<p>Assessor: ${names.get(view.practical.assessor ?? '')}</p>${view.practical.accepted || view.practical.pending ? h`<p>${view.practical.accepted ? 'Accepted.' : 'Submitted and waiting for the assessor.'}</p>` : ''}${!view.practical.accepted && !view.practical.pending && launchable && a.learner === actor.id ? (view.lessonsComplete ? h`<a class="button" href="/app/learn/${id}/practical">Submit evidence</a>` : h`<p class="muted">Available after every lesson is done.</p>`) : ''}`) : ''
  const attempts = view.attempts.length ? card('Attempts', rows(view.attempts.map(attempt => ({ title: h`<a href="/app/attempts/${attempt.id}">${attempt.kind === 'quiz' ? 'Quiz' : 'Practical'} attempt ${attempt.number}</a>`, meta: `${attempt.kind === 'quiz' ? `${attempt.score} of ${attempt.maxScore}${attempt.closeReason === 'expired' ? ', time ran out' : ''}` : attemptState(attempt.state)}; ${attempt.retryDecision}` })))) : ''
  const practiceCard = practice.length ? card('Practice', h`<p class="muted">Optional. Practice does not count toward completion and nobody scores it.</p><ul class="rows">${practice.map(row => h`<li class="row"><a href="/app/practice/${row.id}">${row.title}</a></li>`)}</ul>`) : ''
  const latestReset = view.resets.at(-1)
  const resetNotice = latestReset && a.status === 'open' ? h`<p class="flash" role="status">${a.learner === actor.id ? 'Your progress on this course was reset' : 'Progress was reset'} ${when(latestReset.resetAt, zone)} by ${latestReset.resetByName}: ${latestReset.reason} Lessons start again from the first one, with a fresh set of attempts; the earlier work is kept in the history below.</p>` : ''
  const history = view.resets.length ? card('History before a reset', view.resets.map(reset => h`<section><h3>Reset ${when(reset.resetAt, zone)} by ${reset.resetByName}</h3><p>Reason: ${reset.reason}</p><p class="muted">Before it: ${reset.lessons.length} ${reset.lessons.length === 1 ? 'lesson' : 'lessons'} done${reset.extraAttempts ? `, ${reset.extraAttempts} extra ${reset.extraAttempts === 1 ? 'attempt' : 'attempts'} granted` : ''}.</p>${reset.attempts.length ? rows(reset.attempts.map(attempt => ({ title: h`<a href="/app/attempts/${attempt.id}">${attempt.kind === 'quiz' ? 'Quiz' : 'Practical'} attempt ${attempt.number}</a>`, meta: `${attempt.kind === 'quiz' ? `${attempt.score} of ${attempt.maxScore}` : attempt.closedByReset ? 'closed by the reset before a decision' : attemptState(attempt.state)}; before the reset` }))) : ''}</section>`)) : ''
  const manage = a.learner !== actor.id && (actor.owner || actor.roles.has('manager')) ? a.status === 'open'
    ? h`${card('Due date exception', h`<p>Moves the due date for this person only, with a reason. The earlier due date stays in the history.</p>${form('assignment.due', `/app/learn/${id}`, [hidden('assignment', id), field('New due date', 'dueDate', { type: 'date' }), area('Reason', 'reason')], 'Move the due date', { secondary: true })}`)}${card('Reset progress', h`<p>Starts the lessons again from the first one and gives a fresh set of attempts. Earlier lessons, attempts and evidence stay in this assignment's history; the learner sees why.</p>${form('assignment.reset', `/app/learn/${id}`, [hidden('assignment', id), area('Reason', 'reason')], 'Reset progress', { secondary: true })}`)}`
    : a.status === 'completed' ? card('Assign again', h`<p>A completed assignment is not reset: its completion and certificate stay with revision ${a.revisionNumber}. Assign the course again to train this person once more.</p>${form('assignment.create', `/app/records/${a.learner}`, [hidden('course', a.course), hidden('learners', a.learner), field('Due date', 'dueDate', { type: 'date' })], 'Assign the course again', { secondary: true })}`) : '' : ''
  // A learning administrator's own enrollments carry their window forms (ORG-002, AUTO-009).
  const ownEnrollment = actor.adminUnits.length > 0 && a.assignedBy === actor.id
  const access = a.learner !== actor.id && (actor.owner || actor.roles.has('manager') || ownEnrollment) && (a.status === 'open' || view.access.closesAt) ? accessCard(id, view.access, zone, { owner: actor.owner || ownEnrollment, open: a.status === 'open' }) : ''
  const completion = view.completion ? card('Completion', h`<p><mark class="hl">Completed</mark> ${when(view.completion.completedAt, a.timezone, zone)} against revision ${a.revisionNumber}. <a href="/app/certificates/${view.completion.certificate}">Certificate</a></p>`) : ''
  const body = h`${backLink('/app/learning', 'My learning')}<h1>${a.courseTitle}</h1>
<p class="subtitle">Revision ${a.revisionNumber} · ${a.status} · due ${when(a.dueAt, a.timezone, zone)}${a.status === 'open' && accessNote(view.access, zone) ? ` · ${accessNote(view.access, zone)}` : ''}${a.learner !== actor.id ? h` · learner ${names.get(a.learner)}` : ''}</p>
${view.dueExceptions.length ? h`<p class="muted">${view.dueExceptions.map(change => `Due date moved from ${when(change.previousDueAt, a.timezone, zone)} by ${change.approvedByName}: ${change.reason}`).join(' · ')}</p>` : ''}
${view.blocked ? h`<p class="flash">Complete the prerequisite course first; your manager can see this requirement.</p>` : ''}
${resetNotice}${a.status === 'open' ? accessBanner(view.access, zone) : ''}
${launchable && !view.blocked && resume ? h`<p><a class="button" href="${resume}">${view.lessons.some(lesson => lesson.completed) ? 'Resume' : 'Start'}</a></p>` : ''}
${completion}
<div class="split">${lessons}<div class="stack">${quiz}${practical}${practiceCard}${attempts}${history}${access}${manage}</div></div>`
  return page(a.courseTitle, actor, body, { current: '/app/learning', url })
}

export async function lessonPage(env: Bindings, actor: Actor, id: string, lessonId: string, url: URL) {
  const view = await assignmentView(env, actor, id)
  const index = view.lessons.findIndex(lesson => lesson.id === lessonId)
  if (index < 0) throw new BeamError('not_found', 404)
  requireAccess({ access_opens_at: view.access.opensAt, access_closes_at: view.access.closesAt })
  const lesson = view.lessons[index] as typeof view.lessons[number] & { body: string; sources: string[] }
  const next = view.lessons[index + 1]
  const cited = lesson.sources.length ? await all<{ id: string; number: number; title: string }>(env, `SELECT v.id, v.number, s.title FROM beam_source_versions v JOIN beam_sources s ON s.id = v.source_id WHERE v.id IN (${lesson.sources.map(() => '?').join(', ')}) ORDER BY s.title, v.number`, ...lesson.sources) : []
  const sources = cited.length ? h`<p class="muted source-line">Source material: ${cited.map((version, n) => h`${n ? ', ' : ''}<a href="/app/files/source/${version.id}">${version.title}, version ${version.number}</a>`)}</p>` : ''
  const action = view.assignment.status === 'open' && view.assignment.learner === actor.id && !view.blocked
    ? form('lesson.complete', next ? `/app/learn/${id}/lessons/${next.id}` : `/app/learn/${id}`, [hidden('assignment', id), hidden('lesson', lesson.id)], lesson.completed ? (next ? 'Next lesson' : 'Back to course') : next ? 'Mark done and continue' : 'Mark done')
    : ''
  const body = h`${backLink(`/app/learn/${id}`, view.assignment.courseTitle)}<p class="muted">Lesson ${index + 1} of ${view.lessons.length}</p><h1>${lesson.title}</h1><article class="card lesson-card"><p class="muted lesson-label">Lesson reading</p><div class="lesson-body">${lessonText(lesson.body, { lead: true })}</div></article>${sources}${action}`
  return page(lesson.title, actor, body, { current: '/app/learning', url })
}

export async function quizPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const view = await assignmentView(env, actor, id)
  if (!view.quiz || view.assignment.learner !== actor.id) throw new BeamError('not_found', 404)
  requireAccess({ access_opens_at: view.access.opensAt, access_closes_at: view.access.closesAt })
  const quiz = view.quiz, zone = (await business(env))!.timezone
  const intro = h`<p class="subtitle">Pass mark ${quiz.passPercent}%. ${quiz.attemptsLeft} attempt${quiz.attemptsLeft === 1 ? '' : 's'} left. Each question scores only when every choice, blank, position or pair is right.</p>`
  const back = backLink(`/app/learn/${id}`, view.assignment.courseTitle)
  // LEARN-015: matching questions add their drag-and-drop layer.
  const matching = quiz.questions.some(question => question.kind === 'match') ? ['/beam-match.js'] : []
  // LEARN-018: a timed quiz starts on the server; while it runs the page counts down to the server's deadline.
  if (quiz.timeLimitMinutes) {
    const running = !!quiz.session && view.assignment.status === 'open' && !quiz.passed
    return page('Timed quiz', actor, h`${back}<h1>Timed quiz</h1>${intro}${running ? timedQuiz(id, quiz, zone, Date.now()) : timedStart(id, quiz)}`, { current: '/app/learning', url, script: running ? ['/beam-countdown.js', ...matching] : undefined })
  }
  const body = h`${back}<h1>Quiz</h1>${intro}<div class="card narrow">${form('quiz.submit', `/app/learn/${id}`, [hidden('assignment', id), questionFields(quiz)], 'Submit answers')}</div>`
  return page('Quiz', actor, body, { current: '/app/learning', url, script: matching })
}

export async function practicalPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const view = await assignmentView(env, actor, id)
  if (!view.practical || view.assignment.learner !== actor.id) throw new BeamError('not_found', 404)
  requireAccess({ access_opens_at: view.access.opensAt, access_closes_at: view.access.closesAt })
  const names = await memberNames(env)
  const body = h`${backLink(`/app/learn/${id}`, view.assignment.courseTitle)}<h1>Practical assessment</h1><div class="narrow">${card('Instructions', lessonText(view.practical.instructions ?? ''))}
<section class="card"><p>Your evidence goes to ${names.get(view.practical.assessor ?? '')}, who decides it.</p>${form('practical.submit', `/app/learn/${id}`, [hidden('assignment', id), area('What you did', 'evidence'), fileField('Evidence file (optional)', 'file')], 'Submit for assessment', { multipart: true })}</section></div>`
  return page('Practical assessment', actor, body, { current: '/app/learning', url })
}

export async function certificatePage(env: Bindings, actor: Actor, id: string, url: URL) {
  const certificateView = await certificate(env, actor, id)
  const zone = (await business(env))!.timezone
  const body = h`<article class="card certificate"><p class="lockup"><img src="/brand/mark.svg" alt="" width="24" height="28">${branding.name}</p><p class="muted">Certificate of completion · ${certificateView.number}</p><hr><h1>${certificateView.learner}</h1><p>completed</p><h2>${certificateView.course}</h2><p class="muted">revision ${certificateView.revision} · ${certificateView.method === 'offline' ? 'attested offline training' : certificateView.method === 'assessed' ? 'lessons and assessment' : 'lessons'}</p><p class="muted">on ${formatDate(certificateView.completedAt, zone)}${certificateView.expiresAt ? h` · valid until ${formatDate(certificateView.expiresAt, zone)}` : ''}</p><hr><p class="issuer">Issued by ${certificateView.issuer}</p><p class="muted disclaimer">This certificate records completion of the issuer’s own training. It is not an accreditation or a statement of competence.</p></article><p class="no-print muted print-note"><a href="/app/learning">← My learning</a> · Use your browser’s print command to save a copy.</p>`
  return page('Certificate', actor, body, { current: '/app/learning', url })
}

export async function recordPage(env: Bindings, actor: Actor, memberId: string, url: URL) {
  const record = await learnerRecord(env, actor, memberId)
  const zone = (await business(env))!.timezone
  const extraTime = actor.owner || actor.roles.has('manager') ? accommodationCard(memberId, await accommodations(env, memberId), await listCourses(env) as { id: string; title: string }[], zone) : ''
  // ORG-012: anyone who may manage this person can open their pages read-only; the server refuses the rest.
  const viewAs = memberId !== actor.id && !actor.viewAs ? h`<form method="post" action="/app/view/start">${hidden('learner', memberId)}${hidden('returnTo', `/app/records/${memberId}`)}<button type="submit" class="secondary">View as ${record.member.name}</button></form>` : ''
  const body = h`${backLink('/app/manage', 'Manage')}<h1>${record.member.name}</h1><p class="subtitle">${record.member.email} · <a href="/app/records/${memberId}/transcript">Transcript</a></p>${viewAs}
<section class="card table-card" aria-labelledby="assignments"><h2 class="card-title table-title" id="assignments">Assignments</h2>${record.assignments.length ? h`<div class="table-wrap"><table class="stacked"><thead><tr><th scope="col">Course</th><th scope="col">Revision</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col">Lessons</th></tr></thead><tbody>${record.assignments.map(row => h`<tr><td>${cellLabel('Course')}<a href="/app/learn/${row.id}">${row.courseTitle}</a></td><td>${cellLabel('Revision')}${row.revisionNumber}</td><td class="cell-status">${cellLabel('Status')}${pill(row.state, statusLabel(row))}</td><td>${cellLabel('Due')}${when(row.dueAt, row.timezone, zone)}</td><td>${cellLabel('Lessons')}${row.lessonsDone} of ${row.lessonsTotal}</td></tr>`)}</tbody></table></div>` : h`<p class="muted table-empty">Nothing assigned.</p>`}</section>
${card('Completions', record.completions.length ? rows(record.completions.map(row => ({ title: `${row.courseTitle} revision ${row.revisionNumber}`, meta: h`Completed ${formatDate(row.completedAt, zone)} (${METHOD[row.method] ?? row.method}) · <a href="/app/certificates/${row.certificate}">certificate</a>` }))) : h`<p class="muted">No completions yet.</p>`)}
${extraTime}
${record.history.length ? card('Imported history', h`<p class="muted">Historical evidence from a previous system, not a Beam assessment.</p>${rows(record.history.map(row => ({ title: row.sourceCourseName, meta: `completed ${day(row.completedOn)} in ${row.source}${row.accepted ? ' · reviewed' : ''}` })))}`) : ''}`
  return page(record.member.name, actor, body, { url })
}

export const notFound = (actor: Actor | null) => page('Not found', actor, raw('<h1>Not found</h1><p>This page is not part of Beam, or you cannot open it.</p><p><a href="/app/learning">Back to My learning</a></p>'), { status: 404 })
