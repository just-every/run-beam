import { t, counted } from '../messages'
import { languagePreference } from '../language'
import { one } from '../core'
// Learner pages: my learning, lessons with resume, quiz, practical evidence,
// certificates and a learner's record.
import { externalView } from '../external'
import { externalCard } from './external'
import { myFeedback } from '../feedback'
import { feedbackForm, myFeedbackCard } from './collab'
import { myWaits } from '../registrations'
import { renderBlocks, mediaPage } from './media'
import { embedPolicy, type Block } from '../media'
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
import { manages, permits } from '../scope'
import { blockerCard, exceptionCard, exceptionNotice } from './exceptions'
import { noticeCard } from './inactivity'
import { scenariosFor } from '../practice'
import { myQuestions } from '../questions'
import { announcements } from '../announcements'
import { receivedCard } from './announcements'
import { business, memberNames } from '../people'
import { certificate, learnerRecord, queues, reminders } from '../records'
import { formatDate } from '../time'
import { recognitionCard } from './recognition'
import { notificationCard } from './notifications'
import { discussionCard } from './discussions'
import branding from '../../branding.json'
import { formatDay } from '../time'
import { bookStack, documentSheet } from './drawings'
import { area, backLink, card, cellLabel, field, select, lessonCount, fileField, form, h, hidden, lessonText, page, pill, progress, raw, rows, when, type Html } from './html'
import { icon } from './icons'
import { directoryCard } from './directory'

const STATUS: Record<string, string> = { open: 'Open', completed: 'Completed', expiring: 'Expiring', overdue: 'Overdue', cancelled: 'Canceled', replaced: 'Replaced', deferred: 'Deferred', exempt: 'Exempt' }
const statusLabel = (row: any) => row.state === 'overdue' ? `Overdue, ${row.daysOverdue} ${row.daysOverdue === 1 ? 'day' : 'days'}` : STATUS[row.state] ?? row.state
const METHOD: Record<string, string> = { lessons: 'lessons', assessed: 'lessons and assessment', offline: 'attested offline training' }
const attemptState = (state: string) => ({ awaiting_review: 'waiting for the assessor', accepted: 'accepted', rejected: 'returned for resubmission' } as Record<string, string>)[state] ?? state.replace(/_/g, ' ')
const day = formatDay

export async function dashboard(env: Bindings, actor: Actor, url: URL) {
  const zone = (await business(env))!.timezone
  const preparer = actor.owner || ['author', 'reviewer', 'manager'].some(role => actor.roles.has(role as never))
  const [record, due, work, messages, asked, proposals, acknowledgments, notices, external] = await Promise.all([learnerRecord(env, actor, actor.id), reminders(env, actor), queues(env, actor), reminderMessages(env, actor), myQuestions(env, actor), preparer ? listProposals(env, actor) : [], acknowledgmentList(env, actor), announcements(env, actor), externalView(env, actor)])
  const decidable = proposals.filter(proposal => proposal.canDecide).length
  // LIVE-002: an open seat offer waits for the learner's answer on Sessions.
  const offers = (await myWaits(env, actor)).filter(wait => wait.state === 'offered')
  const offerCard = offers.length ? card('Session seat offered to you', rows(offers.map(wait => ({ title: `${wait.title} — ${wait.courseTitle}`, meta: `Accept by ${when(wait.offerExpiresAt, wait.timezone, zone)}`, href: '/app/sessions' }))), { id: 'offers' }) : ''
  const open = record.assignments.filter(row => row.status === 'open')
  const reminderCard = due.length || messages.length ? card(t(actor, 'Reminders'), h`${rows([
    ...due.map(row => ({ title: row.courseTitle, meta: `${row.kind === 'overdue' ? 'Overdue since' : 'Due'} ${when(row.dueAt, row.timezone, zone)}`, href: `/app/learn/${row.id}` })),
    ...messages.map(row => ({ title: row.courseTitle, meta: h`Message from ${row.approvedBy}: ${row.body}`, href: `/app/learn/${row.assignment}` })),
  ])}<p class="muted foot-note">${t(actor, 'Training that is part of your work is done in paid working time.')}</p>`, { id: 'reminders' }) : ''
  // Anonymous questions stay the learner's own (BEAM-19): a read-only view (ORG-012) does not list them.
  const asks = asked.length && !actor.viewAs ? card('Questions for you', rows(asked.map(row => ({ title: row.title, meta: `Optional · closes ${day(row.closesOn)}`, href: `/app/questions/${row.id}` }))), { id: 'asked' }) : ''
  const agent = decidable ? card('Agent work', h`<p><a href="/app/agent">${decidable} ${decidable === 1 ? 'proposal is' : 'proposals are'} waiting for your decision</a></p>`, { id: 'agent' }) : ''
  const review = work.reviews.length || work.notices.length || work.contentReviews.length ? card('Waiting for my review', rows([
    ...work.reviews.map(row => ({ title: `${row.title} revision ${row.number}`, href: `/app/revisions/${row.id}` })),
    ...work.notices.map(row => ({ title: row.courseTitle, meta: h`Source “${row.sourceTitle}” has a new version`, href: `/app/courses/${row.course}` })),
    ...work.contentReviews.map(row => ({ title: row.courseTitle, meta: `Scheduled content review due ${row.dueOn}`, href: `/app/courses/${row.course}#upkeep` })),
  ]), { id: 'review' }) : ''
  const assess = work.assessments.length ? card('Evidence and written answers to assess', rows(work.assessments.map(row => ({ title: `${row.learnerName} — ${row.courseTitle}`, href: `/app/attempts/${row.id}` }))), { id: 'assess' }) : ''
  const assigned = card(t(actor, 'Assigned to me'), open.length ? rows(open.map(row => ({ title: row.courseTitle, meta: [t(actor, 'Revision {revision}', { revision: row.revisionNumber }), t(actor, '{done} of {total} lessons', { done: row.lessonsDone, total: row.lessonsTotal }), t(actor, 'Due {date}', { date: formatDate(row.dueAt, row.timezone, actor.locale) }), accessNote({ state: row.access, opensAt: row.accessOpensAt, closesAt: row.accessClosesAt }, zone)].filter(Boolean).join(' · '), aside: progress(row.lessonsDone, row.lessonsTotal), href: `/app/learn/${row.id}` }))) : h`<p>${t(actor, 'Nothing is assigned to you right now.')}</p>${raw(bookStack)}`, { id: 'assigned', className: open.length ? '' : 'empty' })
  const completed = card(t(actor, 'Completed'), record.completions.length ? rows(record.completions.map(row => ({ title: `${row.courseTitle} (revision ${row.revisionNumber})`, meta: h`${formatDate(row.completedAt, zone, actor.locale)}${row.expiresAt ? h` · renew by ${formatDate(row.expiresAt, zone, actor.locale)}` : ''} · <a href="/app/certificates/${row.certificate}">${t(actor, 'Certificate')}</a>` }))) : h`<p>${t(actor, 'No completions yet.')}</p>${raw(documentSheet)}`, { id: 'done', className: record.completions.length ? '' : 'empty' })
  const side = [review, assess].filter(Boolean)
  const body = h`<h1>${t(actor, 'My learning')}</h1>
${actor.viewAs ? '' : form('language.change', '/app/learning', [select(t(actor, 'Language'), 'language', [{ value: 'default', label: t(actor, 'Use employer default') }, { value: 'en-US', label: 'English (US)' }, { value: 'es-US', label: 'Español (EE. UU.)' }], (await one(env, 'SELECT language FROM beam_members WHERE id=?', actor.id))?.language ?? 'default')], t(actor, 'Save language'), { secondary: true })}
${await notificationCard(env, actor, zone)}${await noticeCard(env, actor, zone)}${offerCard}${reminderCard}${externalCard(external)}${await recognitionCard(env, actor)}${await discussionCard(env, actor)}${receivedCard(notices.received, actor, zone)}${acknowledgmentCard(acknowledgments.mine)}${asks}${agent}
${open.length ? assigned : ''}
<div class="grid">${open.length ? '' : assigned}${completed}${side}</div>`
  return page(t(actor, 'My learning'), actor, body, { current: '/app/learning', url })
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
  const lessons = card(t(actor, 'Lessons'), h`<ol class="rows numbered">${view.lessons.map(lesson => h`<li><a class="row row-link" href="/app/learn/${id}/lessons/${lesson.id}"><span class="row-text"><span class="row-title">${lesson.title}</span></span>${lesson.completed ? h`<span class="tag done">done</span>` : ''}${raw(icon('chevron', { size: 20, className: 'chevron' }))}</a></li>`)}</ol>`)
  const timeLimit = view.quiz?.timeLimitMinutes ? ` Time limit ${view.quiz.timeLimitMinutes} minutes${view.quiz.extraMinutes ? `, plus ${view.quiz.extraMinutes} minutes extra time (${accommodationLabel(view.quiz.accommodation!)})` : ''}.` : ''
  const drawn = view.quiz?.draw ? ` Each attempt draws ${view.quiz.draw} of ${view.quiz.bank} questions.` : ''
  const quiz = view.quiz ? card(t(actor, 'Quiz'), h`<p>${t(actor, 'Pass mark {percent}%.', { percent: view.quiz.passPercent })}${drawn} ${view.quiz.passed ? t(actor, 'Passed.') : view.quiz.grading ? t(actor, 'Your written answers are waiting for the assessor.') : t(actor, '{n} attempts left.', { n: view.quiz.attemptsLeft })}${timeLimit}</p>${!view.quiz.passed && !view.quiz.grading && launchable && a.learner === actor.id ? (view.lessonsComplete ? h`<a class="button" href="/app/learn/${id}/quiz">${view.quiz.session ? t(actor, 'Return to the timed quiz') : t(actor, 'Take the quiz')}</a>` : h`<p class="muted">Available after every lesson is done.</p>`) : ''}`) : ''
  // AUTHOR-003: the learner's own feedback on this course and each outcome.
  const feedbackCard = view.assignment.learner === actor.id && !actor.viewAs ? myFeedbackCard(await myFeedback(env, actor, view.assignment.course), zone) : ''
  // AUTHOR-010: each move to a newer revision, with what it kept and reopened.
  const moved = view.moves.length ? card('Moved to a newer revision', rows(view.moves.map((move: any) => ({ title: `Revision ${move.fromRevision} to revision ${move.toRevision}`, meta: `${move.movedByName}, ${when(move.movedAt, zone)} · ${move.kept.length} ${move.kept.length === 1 ? 'lesson' : 'lessons'} kept, ${move.reopened.length} to do${move.assessment === 'unchanged' ? ' · your attempts carried over' : move.assessment === 'changed' ? ' · the assessment changed' : ''}` })))) : ''
  // LIVE-003: the revision also requires attending a session; the instructor's roster decides it.
  const attendance = view.attendance ? card('Session attendance', h`<p>Attend a session of this course for at least ${view.attendance.percent}% of its scheduled time. ${view.attendance.met ? 'Met.' : view.attendance.record ? 'Recorded, not yet met.' : 'Not yet recorded.'}</p>${view.attendanceRecords.length ? rows(view.attendanceRecords.map((item: any) => ({ title: `${item.sessionTitle}: ${item.status}, ${item.minutes} min, ${item.decision}${item.supersededAt ? ' (superseded)' : ''}`, meta: h`${item.amends ? `Amendment: ${item.reason} · ` : ''}${item.recordedByName}, ${when(item.recordedAt, zone)}${item.attachment ? h` · <a href="/app/files/attachment/${item.attachment}">Evidence</a>` : ''}` }))) : ''}<p><a href="/app/sessions">Sessions</a></p>`) : ''
  const practical = view.practical ? card(t(actor, 'Practical assessment'), h`<p>Assessor: ${names.get(view.practical.assessor ?? '')}</p>${view.practical.accepted || view.practical.pending ? h`<p>${view.practical.accepted ? 'Accepted.' : 'Submitted and waiting for the assessor.'}</p>` : ''}${!view.practical.accepted && !view.practical.pending && launchable && a.learner === actor.id ? (view.lessonsComplete ? h`<a class="button" href="/app/learn/${id}/practical">Submit evidence</a>` : h`<p class="muted">Available after every lesson is done.</p>`) : ''}`) : ''
  const attempts = view.attempts.length ? card('Attempts', rows(view.attempts.map(attempt => ({ title: h`<a href="/app/attempts/${attempt.id}">${attempt.kind === 'quiz' ? t(actor, 'Quiz') : 'Practical'} attempt ${attempt.number}</a>`, meta: `${attempt.kind === 'quiz' ? attempt.state === 'awaiting_review' ? `${attempt.score} of ${attempt.maxScore} so far` : `${attempt.score} of ${attempt.maxScore}${attempt.closeReason === 'expired' ? ', time ran out' : ''}` : attemptState(attempt.state)}; ${attempt.retryDecision}` })))) : ''
  const practiceCard = practice.length ? card('Practice', h`<p class="muted">Optional. Practice does not count toward completion and nobody scores it.</p><ul class="rows">${practice.map(row => h`<li class="row"><a href="/app/practice/${row.id}">${row.title}</a></li>`)}</ul>`) : ''
  const latestReset = view.resets.at(-1)
  const resetNotice = latestReset && a.status === 'open' ? h`<p class="flash" role="status">${a.learner === actor.id ? 'Your progress on this course was reset' : 'Progress was reset'} ${when(latestReset.resetAt, zone)} by ${latestReset.resetByName}: ${latestReset.reason} Lessons start again from the first one, with a fresh set of attempts; the earlier work is kept in the history below.</p>` : ''
  const history = view.resets.length ? card('History before a reset', view.resets.map(reset => h`<section><h3>${reset.kind === 'move' ? 'Moved to a new revision' : 'Reset'} ${when(reset.resetAt, zone)} by ${reset.resetByName}</h3><p>Reason: ${reset.reason}</p><p class="muted">Before it: ${reset.lessons.length} ${reset.lessons.length === 1 ? 'lesson' : 'lessons'} done${reset.extraAttempts ? `, ${reset.extraAttempts} extra ${reset.extraAttempts === 1 ? 'attempt' : 'attempts'} granted` : ''}.</p>${reset.attempts.length ? rows(reset.attempts.map(attempt => ({ title: h`<a href="/app/attempts/${attempt.id}">${attempt.kind === 'quiz' ? t(actor, 'Quiz') : 'Practical'} attempt ${attempt.number}</a>`, meta: `${attempt.kind === 'quiz' ? `${attempt.score} of ${attempt.maxScore}` : attempt.closedByReset ? 'closed by the reset before a decision' : attemptState(attempt.state)}; before the reset` }))) : ''}</section>`)) : ''
  const manage = a.learner !== actor.id && (actor.owner || actor.roles.has('manager')) ? a.status === 'open'
    ? h`${card('Due date exception', h`<p>Moves the due date for this person only, with a reason. The earlier due date stays in the history.</p>${form('assignment.due', `/app/learn/${id}`, [hidden('assignment', id), field('New due date', 'dueDate', { type: 'date' }), area('Reason', 'reason')], 'Move the due date', { secondary: true })}`)}${card('Reset progress', h`<p>Starts the lessons again from the first one and gives a fresh set of attempts. Earlier lessons, attempts and evidence stay in this assignment's history; the learner sees why.</p>${form('assignment.reset', `/app/learn/${id}`, [hidden('assignment', id), area('Reason', 'reason')], 'Reset progress', { secondary: true })}`)}`
    : a.status === 'completed' ? card('Assign again', h`<p>A completed assignment is not reset: its completion and certificate stay with revision ${a.revisionNumber}. Assign the course again to train this person once more.</p>${form('assignment.create', `/app/records/${a.learner}`, [hidden('course', a.course), hidden('learners', a.learner), field('Due date', 'dueDate', { type: 'date' })], 'Assign the course again', { secondary: true })}`) : '' : ''
  // A learning administrator's own enrollments carry their window forms (ORG-002, AUTO-009).
  const ownEnrollment = actor.adminUnits.length > 0 && a.assignedBy === actor.id
  const access = a.learner !== actor.id && (actor.owner || actor.roles.has('manager') || ownEnrollment) && (a.status === 'open' || view.access.closesAt) ? accessCard(id, view.access, zone, { owner: actor.owner || ownEnrollment, open: a.status === 'open' }) : ''
  // AUTO-006: the learner reports a blocker; whoever may enroll them defers, exempts or declines it.
  const blockers = a.learner === actor.id ? blockerCard(view, id, zone) : ''
  const exceptions = a.learner !== actor.id && permits(actor, 'enrollment') ? exceptionCard(view, id, zone) : ''
  const completion = view.completion ? card(t(actor, 'Completion'), h`<p><mark class="hl">Completed</mark> ${when(view.completion.completedAt, a.timezone, zone)} against revision ${a.revisionNumber}. <a href="/app/certificates/${view.completion.certificate}">${t(actor, 'Certificate')}</a></p>`) : ''
  const body = h`${backLink('/app/learning', t(actor, 'My learning'))}${await courseLanguageNote(env, actor, a.course)}<h1>${a.courseTitle}</h1>
<p class="subtitle">Revision ${a.revisionNumber} · ${t(actor, STATUS[a.status] ?? a.status)} · ${t(actor, 'Due {date}', { date: formatDate(a.dueAt, a.timezone, actor.locale) })}${a.status === 'open' && accessNote(view.access, zone) ? ` · ${accessNote(view.access, zone)}` : ''}${a.learner !== actor.id ? h` · learner ${names.get(a.learner)}` : ''}</p>
${view.dueExceptions.length ? h`<p class="muted">${view.dueExceptions.map(change => `Due date moved from ${when(change.previousDueAt, a.timezone, zone)} by ${change.approvedByName}: ${change.reason}`).join(' · ')}</p>` : ''}
${view.blocked ? h`<p class="flash">Complete the prerequisite course first; your manager can see this requirement.</p>` : ''}
${resetNotice}${exceptionNotice(view, a, zone)}${a.status === 'open' ? accessBanner(view.access, zone) : ''}
${launchable && !view.blocked && resume ? h`<p><a class="button" href="${resume}">${view.lessons.some(lesson => lesson.completed) ? t(actor, 'Resume') : t(actor, 'Start')}</a></p>` : ''}
${completion}${view.externalTools.length ? card('External learning tools', view.externalTools.map(tool => h`<div><h3>${tool.title}</h3><p>${tool.passed ? 'Required grade received' : `Required grade: ${tool.passPercent}%`}. Native lessons and assessment are still required.</p>${launchable && !view.blocked && a.learner === actor.id && !actor.viewAs ? h`<form method="post" action="/app/lti/launch">${hidden('assignment', id)}${hidden('resource', tool.resource)}<button type="submit">Open ${tool.title}</button></form>` : ''}</div>`)) : ''}
<div class="split">${lessons}<div class="stack">${moved}${feedbackCard}${quiz}${surveyCard(id, view, actor)}${practical}${attendance}${practiceCard}${attempts}${history}${access}${blockers}${manage}${exceptions}</div></div>`
  return page(a.courseTitle, actor, body, { current: '/app/learning', url })
}

export async function lessonPage(env: Bindings, actor: Actor, id: string, lessonId: string, url: URL) {
  const view = await assignmentView(env, actor, id)
  const index = view.lessons.findIndex(lesson => lesson.id === lessonId)
  if (index < 0) throw new BeamError('not_found', 404)
  requireAccess({ access_opens_at: view.access.opensAt, access_closes_at: view.access.closesAt })
  const lesson = view.lessons[index] as typeof view.lessons[number] & { body: string; sources: string[]; blocks?: Block[] }
  const next = view.lessons[index + 1]
  const cited = lesson.sources.length ? await all<{ id: string; number: number; title: string }>(env, `SELECT v.id, v.number, s.title FROM beam_source_versions v JOIN beam_sources s ON s.id = v.source_id WHERE v.id IN (${lesson.sources.map(() => '?').join(', ')}) ORDER BY s.title, v.number`, ...lesson.sources) : []
  const sources = cited.length ? h`<p class="muted source-line">Source material: ${cited.map((version, n) => h`${n ? ', ' : ''}<a href="/app/files/source/${version.id}">${version.title}, version ${version.number}</a>`)}</p>` : ''
  const action = view.assignment.status === 'open' && view.assignment.learner === actor.id && !view.blocked
    ? form('lesson.complete', next ? `/app/learn/${id}/lessons/${next.id}` : `/app/learn/${id}`, [hidden('assignment', id), hidden('lesson', lesson.id)], lesson.completed ? (next ? t(actor, 'Next lesson') : t(actor, 'Back to course')) : next ? t(actor, 'Mark done and continue') : t(actor, 'Mark done'))
    : ''
  const body = h`${backLink(`/app/learn/${id}`, view.assignment.courseTitle)}<p class="muted">${t(actor, 'Lesson {n} of {total}', { n: index + 1, total: view.lessons.length })}</p><h1>${lesson.title}</h1><article class="card lesson-card"><p class="muted lesson-label">${t(actor, 'Lesson reading')}</p><div class="lesson-body">${await courseLanguageNote(env, actor, view.assignment.course)}${lessonText(lesson.body, { lead: true })}${renderBlocks(lesson.blocks, (await embedPolicy(env)).hosts)}</div></article>${sources}${action}${view.assignment.learner === actor.id && !actor.viewAs ? h`${feedbackForm(id, lessonId, `/app/learn/${id}/lessons/${lessonId}`)}<p><a href="/app/discussions/${view.assignment.course}?lesson=${lessonId}">Ask about this lesson or discuss it</a></p>` : ''}`
  return mediaPage(env, page(lesson.title, actor, body, { current: '/app/learning', url }))
}

export async function quizPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const view = await assignmentView(env, actor, id)
  if (!view.quiz || view.assignment.learner !== actor.id) throw new BeamError('not_found', 404)
  requireAccess({ access_opens_at: view.access.opensAt, access_closes_at: view.access.closesAt })
  const quiz = view.quiz, zone = (await business(env))!.timezone
  const intro = h`<p class="subtitle">${t(actor, 'Pass mark {percent}%.', { percent: quiz.passPercent })} ${t(actor, '{n} attempts left.', { n: quiz.attemptsLeft })} ${t(actor, '{questions} worth {points}.', { questions: counted(actor, 'question', 'questions', quiz.questions.length), points: counted(actor, 'point', 'points', quiz.points) })}${quiz.draw ? ` (${quiz.bank})` : ''} ${t(actor, 'Each question earns its points only when every choice, blank, position or pair is right; written answers earn what the assessor awards.')}</p>`
  const back = backLink(`/app/learn/${id}`, view.assignment.courseTitle)
  // LEARN-015: matching questions add their drag-and-drop layer.
  const matching = quiz.questions.some(question => question.kind === 'match') ? ['/beam-match.js'] : []
  // LEARN-018: a timed quiz starts on the server; while it runs the page counts down to the server's deadline.
  if (quiz.timeLimitMinutes) {
    const running = !!quiz.session && view.assignment.status === 'open' && !quiz.passed
    return page('Timed quiz', actor, h`${back}<h1>Timed quiz</h1>${intro}${running ? timedQuiz(id, quiz, zone, Date.now()) : timedStart(id, quiz)}`, { current: '/app/learning', url, script: running ? ['/beam-countdown.js', ...matching] : undefined })
  }
  const body = h`${back}<h1>${t(actor, 'Quiz')}</h1>${intro}<div class="card narrow">${form('quiz.submit', `/app/learn/${id}`, [hidden('assignment', id), questionFields(quiz, {}, actor.locale)], t(actor, 'Submit answers'))}</div>`
  return page(t(actor, 'Quiz'), actor, body, { current: '/app/learning', url, script: matching })
}

export async function practicalPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const view = await assignmentView(env, actor, id)
  if (!view.practical || view.assignment.learner !== actor.id) throw new BeamError('not_found', 404)
  requireAccess({ access_opens_at: view.access.opensAt, access_closes_at: view.access.closesAt })
  const names = await memberNames(env)
  const body = h`${backLink(`/app/learn/${id}`, view.assignment.courseTitle)}<h1>${t(actor, 'Practical assessment')}</h1><div class="narrow">${card('Instructions', lessonText(view.practical.instructions ?? ''))}
<section class="card"><p>Your evidence goes to ${names.get(view.practical.assessor ?? '')}, who decides it.</p>${form('practical.submit', `/app/learn/${id}`, [hidden('assignment', id), area('What you did', 'evidence'), fileField('Evidence file (optional)', 'file')], 'Submit for assessment', { multipart: true })}</section></div>`
  return page(t(actor, 'Practical assessment'), actor, body, { current: '/app/learning', url })
}

export async function recordPage(env: Bindings, actor: Actor, memberId: string, url: URL) {
  const record = await learnerRecord(env, actor, memberId)
  const zone = (await business(env))!.timezone
  const extraTime = actor.owner || actor.roles.has('manager') ? accommodationCard(memberId, await accommodations(env, memberId), await listCourses(env) as { id: string; title: string }[], zone) : ''
  // ORG-012: the owner, their manager or their unit's learning administrator can open their pages read-only (not a custom
  // role); the server refuses the rest.
  const viewAs = memberId !== actor.id && !actor.viewAs && manages(actor, memberId) ? h`<form method="post" action="/app/view/start">${hidden('learner', memberId)}${hidden('returnTo', `/app/records/${memberId}`)}<button type="submit" class="secondary">View as ${record.member.name}</button></form>` : ''
  const body = h`${backLink('/app/manage', 'Manage')}<h1>${record.member.name}</h1><p class="subtitle">${record.member.email ?? 'No work email'} · <a href="/app/records/${memberId}/transcript">Transcript</a></p>${viewAs}
<section class="card table-card" aria-labelledby="assignments"><h2 class="card-title table-title" id="assignments">Assignments</h2>${record.assignments.length ? h`<div class="table-wrap"><table class="stacked"><thead><tr><th scope="col">Course</th><th scope="col">Revision</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col">Lessons</th></tr></thead><tbody>${record.assignments.map(row => h`<tr><td>${cellLabel('Course')}<a href="/app/learn/${row.id}">${row.courseTitle}</a></td><td>${cellLabel('Revision')}${row.revisionNumber}</td><td class="cell-status">${cellLabel('Status')}${pill(row.state, statusLabel(row))}</td><td>${cellLabel('Due')}${when(row.dueAt, row.timezone, zone)}</td><td>${cellLabel(t(actor, 'Lessons'))}${row.lessonsDone} of ${row.lessonsTotal}</td></tr>`)}</tbody></table></div>` : h`<p class="muted table-empty">Nothing assigned.</p>`}</section>
${card('Completions', record.completions.length ? rows(record.completions.map(row => ({ title: `${row.courseTitle} revision ${row.revisionNumber}`, meta: h`Completed ${formatDate(row.completedAt, zone, actor.locale)} (${METHOD[row.method] ?? row.method}) · <a href="/app/certificates/${row.certificate}">certificate</a>` }))) : h`<p class="muted">${t(actor, 'No completions yet.')}</p>`)}
${extraTime}
${await directoryCard(env, actor, memberId, zone)}
${record.history.length ? card('Imported history', h`<p class="muted">Historical evidence from a previous system, not a Beam assessment.</p>${rows(record.history.map(row => ({ title: row.sourceCourseName, meta: `completed ${day(row.completedOn)} in ${row.source}${row.accepted ? ' · reviewed' : ''}` })))}`) : ''}`
  return page(record.member.name, actor, body, { url })
}

export const notFound = (actor: Actor | null) => page('Not found', actor, raw('<h1>Not found</h1><p>This page is not part of Beam, or you cannot open it.</p><p><a href="/app/learning">Back to My learning</a></p>'), { status: 404 })

/** LEARN-001: the revision's satisfaction survey, optional and never part of passing or completion. */
function surveyCard(id: string, view: Awaited<ReturnType<typeof assignmentView>>, actor: Actor) {
  if (!view.survey.questions.length || view.assignment.learner !== actor.id || actor.viewAs) return ''
  if (view.survey.answered) return card('Course survey', h`<p>Thank you: your survey answers were recorded without your name.</p>`)
  if (!view.lessonsComplete) return card('Course survey', h`<p class="muted">Available after every lesson is done. It is optional and never affects passing or completion.</p>`)
  const fields = view.survey.questions.map(item => item.kind === 'rating'
    ? select(item.prompt, `s_${item.id}`, ['1', '2', '3', '4', '5'].map(value => ({ value, label: value })), '', { required: false, blank: '—' })
    : area(item.prompt, `s_${item.id}`, '', false))
  return card('Course survey', h`<p class="muted">Optional. Answers are kept without your name and never affect passing or completion.</p>${form('survey.answer', `/app/learn/${id}`, [hidden('assignment', id), ...fields], 'Send survey')}`)
}

async function courseLanguageNote(env: Bindings, actor: Actor, course: string) {
 const original = (await one(env, 'SELECT language FROM beam_courses WHERE id=?', course))?.language ?? 'en'
 if (original.toLowerCase().split('-')[0] === (actor.locale ?? 'en-US').split('-')[0]) return ''
 return card(t(actor, 'Language fallback'), h`<p>${t(actor, 'A reviewed {language} version is not available. This course opens in its original language ({original}).', { language: t(actor, actor.locale === 'es-US' ? 'Spanish' : 'English'), original })}</p>`)
}
