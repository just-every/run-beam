import { learnerPackages } from './packages'
import { localeRevisionLanguage } from '../course-locales'
import { historyCredits } from './history-credits'
import { t, counted, localeNumber, quizDecision } from '../messages'
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
const statusLabel = (row: any, actor: Actor) => row.state === 'overdue' ? `${t(actor, 'Overdue')}, ${counted(actor, 'day', 'days', row.daysOverdue)}` : t(actor, STATUS[row.state] ?? row.state)
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
  const offerCard = offers.length ? card(t(actor, 'Session seat offered to you'), rows(offers.map(wait => ({ title: `${wait.title} — ${wait.courseTitle}`, meta: t(actor, 'Accept by {date}', { date: when(wait.offerExpiresAt, wait.timezone, zone, actor.locale) }), href: '/app/sessions' }))), { id: 'offers' }) : ''
  const open = record.assignments.filter(row => row.status === 'open')
  const reminderCard = due.length || messages.length ? card(t(actor, 'Reminders'), h`${rows([
    ...due.map(row => ({ title: row.courseTitle, meta: `${row.kind === 'overdue' ? t(actor, 'Overdue since') : t(actor, 'Due')} ${when(row.dueAt, row.timezone, zone, actor.locale)}`, href: `/app/learn/${row.id}` })),
    ...messages.map(row => ({ title: row.courseTitle, meta: t(actor, 'Message from {name}: {body}', { name: row.approvedBy, body: row.body }), href: `/app/learn/${row.assignment}` })),
  ])}<p class="muted foot-note">${t(actor, 'Training that is part of your work is done in paid working time.')}</p>`, { id: 'reminders' }) : ''
  // Anonymous questions stay the learner's own (BEAM-19): a read-only view (ORG-012) does not list them.
  const asks = asked.length && !actor.viewAs ? card(t(actor, 'Questions for you'), rows(asked.map(row => ({ title: row.title, meta: t(actor, 'Optional · closes {date}', { date: day(row.closesOn, actor.locale) }), href: `/app/questions/${row.id}` }))), { id: 'asked' }) : ''
  const agent = decidable ? card('Agent work', h`<p><a href="/app/agent">${decidable} ${decidable === 1 ? 'proposal is' : 'proposals are'} waiting for your decision</a></p>`, { id: 'agent' }) : ''
  const review = work.reviews.length || work.notices.length || work.contentReviews.length ? card('Waiting for my review', rows([
    ...work.reviews.map(row => ({ title: `${row.title} revision ${row.number}`, href: `/app/revisions/${row.id}` })),
    ...work.notices.map(row => ({ title: row.courseTitle, meta: h`Source “${row.sourceTitle}” has a new version`, href: `/app/courses/${row.course}` })),
    ...work.contentReviews.map(row => ({ title: row.courseTitle, meta: `Scheduled content review due ${row.dueOn}`, href: `/app/courses/${row.course}#upkeep` })),
  ]), { id: 'review' }) : ''
  const assess = work.assessments.length ? card('Evidence and written answers to assess', rows(work.assessments.map(row => ({ title: `${row.learnerName} — ${row.courseTitle}`, href: `/app/attempts/${row.id}` }))), { id: 'assess' }) : ''
  const assigned = card(t(actor, 'Assigned to me'), open.length ? rows(open.map(row => ({ title: row.courseTitle, meta: [t(actor, 'Revision {revision}', { revision: row.revisionNumber }), t(actor, '{done} of {total} lessons', { done: row.lessonsDone, total: row.lessonsTotal }), t(actor, 'Due {date}', { date: formatDate(row.dueAt, row.timezone, actor.locale) }), accessNote({ state: row.access, opensAt: row.accessOpensAt, closesAt: row.accessClosesAt }, zone, actor.locale)].filter(Boolean).join(' · '), aside: progress(row.lessonsDone, row.lessonsTotal), href: `/app/learn/${row.id}` }))) : h`<p>${t(actor, 'Nothing is assigned to you right now.')}</p>${raw(bookStack)}`, { id: 'assigned', className: open.length ? '' : 'empty' })
  const completed = card(t(actor, 'Completed'), record.completions.length ? rows(record.completions.map(row => ({ title: `${row.courseTitle} (${t(actor, 'revision')} ${localeNumber(actor, row.revisionNumber)})`, meta: h`${formatDate(row.completedAt, zone, actor.locale)}${row.expiresAt ? h` · ${t(actor, 'renew by')} ${formatDate(row.expiresAt, zone, actor.locale)}` : ''} · <a href="/app/certificates/${row.certificate}">${t(actor, 'Certificate')}</a>` }))) : h`<p>${t(actor, 'No completions yet.')}</p>${raw(documentSheet)}`, { id: 'done', className: record.completions.length ? '' : 'empty' })
  const side = [review, assess].filter(Boolean)
  const body = h`<h1>${t(actor, 'My learning')}</h1>
${actor.viewAs ? '' : form('language.change', '/app/learning', [select(t(actor, 'Language'), 'language', [{ value: 'default', label: t(actor, 'Use employer default') }, { value: 'en-US', label: 'English (US)' }, { value: 'es-US', label: 'Español (EE. UU.)' }], (await one(env, 'SELECT language FROM beam_members WHERE id=?', actor.id))?.language ?? 'default')], t(actor, 'Save language'), { secondary: true })}
${await notificationCard(env, actor, zone)}${await noticeCard(env, actor, zone)}${offerCard}${reminderCard}${externalCard(external, actor)}${await recognitionCard(env, actor)}${await discussionCard(env, actor)}${receivedCard(notices.received, actor, zone)}${acknowledgmentCard(acknowledgments.mine, actor.locale)}${asks}${agent}
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
  const lessons = view.lessons.length ? card(t(actor, 'Lessons'), h`<ol class="rows numbered">${view.lessons.map(lesson => h`<li><a class="row row-link" href="/app/learn/${id}/lessons/${lesson.id}"><span class="row-text"><span class="row-title">${lesson.title}</span></span>${lesson.completed ? h`<span class="tag done">${t(actor, 'done')}</span>` : ''}${raw(icon('chevron', { size: 20, className: 'chevron' }))}</a></li>`)}</ol>`) : ''
  const timeLimit = view.quiz?.timeLimitMinutes ? ` ${t(actor, 'Time limit {n} minutes.', { n: localeNumber(actor, view.quiz.timeLimitMinutes) })}${view.quiz.extraMinutes ? t(actor, ' plus {n} minutes extra time ({accommodation})', { n: localeNumber(actor, view.quiz.extraMinutes), accommodation: accommodationLabel(view.quiz.accommodation!, undefined, actor.locale) }) : ''}` : ''
  const drawn = view.quiz?.draw ? ` ${t(actor, 'Each attempt draws {n} of {bank} questions.', { n: localeNumber(actor, view.quiz.draw), bank: localeNumber(actor, view.quiz.bank) })}` : ''
  const quiz = view.quiz ? card(t(actor, 'Quiz'), h`<p>${t(actor, 'Pass mark {percent}%.', { percent: view.quiz.passPercent })}${drawn} ${view.quiz.passed ? t(actor, 'Passed.') : view.quiz.grading ? t(actor, 'Your written answers are waiting for the assessor.') : t(actor, '{n} attempts left.', { n: view.quiz.attemptsLeft })}${timeLimit}</p>${!view.quiz.passed && !view.quiz.grading && launchable && a.learner === actor.id ? (view.lessonsComplete ? h`<a class="button" href="/app/learn/${id}/quiz">${view.quiz.session ? t(actor, 'Return to the timed quiz') : t(actor, 'Take the quiz')}</a>` : h`<p class="muted">${t(actor, 'Available after every lesson is done.')}</p>`) : ''}`) : ''
  // AUTHOR-003: the learner's own feedback on this course and each outcome.
  const feedbackCard = view.assignment.learner === actor.id && !actor.viewAs ? myFeedbackCard(await myFeedback(env, actor, view.assignment.course), zone, actor.locale) : ''
  // AUTHOR-010: each move to a newer revision, with what it kept and reopened.
  const moved = view.moves.length ? card(t(actor, 'Moved to a newer revision'), rows(view.moves.map((move: any) => ({ title: t(actor, 'Revision {from} to revision {to}', { from: move.fromRevision, to: move.toRevision }), meta: `${move.movedByName}, ${when(move.movedAt, zone, zone, actor.locale)} · ${t(actor, '{kept} kept, {n} to do', { kept: counted(actor, 'lesson', 'lessons', move.kept.length), n: move.reopened.length })}${move.assessment === 'unchanged' ? ` · ${t(actor, 'your attempts carried over')}` : move.assessment === 'changed' ? ` · ${t(actor, 'the assessment changed')}` : ''}` })))) : ''
  // LIVE-003: the revision also requires attending a session; the instructor's roster decides it.
  const attendance = view.attendance ? card(t(actor, 'Session attendance'), h`<p>${t(actor, 'Attend a session of this course for at least {percent}% of its scheduled time.', { percent: view.attendance.percent })} ${t(actor, view.attendance.met ? 'Met.' : view.attendance.record ? 'Recorded, not yet met.' : 'Not yet recorded.')}</p>${view.attendanceRecords.length ? rows(view.attendanceRecords.map((item: any) => ({ title: `${item.sessionTitle}: ${t(actor, item.status)}, ${t(actor, '{n} min', { n: item.minutes })}, ${t(actor, item.decision)}${item.supersededAt ? t(actor, ' (superseded)') : ''}`, meta: h`${item.amends ? `${t(actor, 'Amendment: {reason}', { reason: item.reason })} · ` : ''}${item.recordedByName}, ${when(item.recordedAt, zone, zone, actor.locale)}${item.attachment ? h` · <a href="/app/files/attachment/${item.attachment}">${t(actor, 'Evidence')}</a>` : ''}` }))) : ''}<p><a href="/app/sessions">${t(actor, 'Sessions')}</a></p>`) : ''
  const practical = view.practical ? card(t(actor, 'Practical assessment'), h`<p>${t(actor, 'Assessor:')} ${names.get(view.practical.assessor ?? '')}</p>${view.practical.accepted || view.practical.pending ? h`<p>${view.practical.accepted ? t(actor, 'Accepted.') : t(actor, 'Submitted and waiting for the assessor.')}</p>` : ''}${!view.practical.accepted && !view.practical.pending && launchable && a.learner === actor.id ? (view.lessonsComplete ? h`<a class="button" href="/app/learn/${id}/practical">${t(actor, 'Submit evidence')}</a>` : h`<p class="muted">${t(actor, 'Available after every lesson is done.')}</p>`) : ''}`) : ''
  const attempts = view.attempts.length ? card(t(actor, 'Attempts'), rows(view.attempts.map(attempt => ({ title: h`<a href="/app/attempts/${attempt.id}">${t(actor, '{kind} attempt {n}', { kind: t(actor, attempt.kind === 'quiz' ? 'Quiz' : 'Practical'), n: localeNumber(actor, attempt.number) })}</a>`, meta: `${attempt.kind === 'quiz' ? attempt.state === 'awaiting_review' ? t(actor, '{score} of {total} so far', { score: localeNumber(actor, attempt.score), total: localeNumber(actor, attempt.maxScore) }) : `${t(actor, '{score} of {total}', { score: localeNumber(actor, attempt.score), total: localeNumber(actor, attempt.maxScore) })}${attempt.closeReason === 'expired' ? `, ${t(actor, 'time ran out')}` : ''}` : t(actor, attemptState(attempt.state))}; ${quizDecision(actor, attempt.retryDecision)}` })))) : ''
  const practiceCard = practice.length ? card(t(actor, 'Practice'), h`<p class="muted">${t(actor, 'Optional. Practice does not count toward completion and nobody scores it.')}</p><ul class="rows">${practice.map(row => h`<li class="row"><a href="/app/practice/${row.id}">${row.title}</a></li>`)}</ul>`) : ''
  const latestReset = view.resets.at(-1)
  const resetNotice = latestReset && a.status === 'open' ? h`<p class="flash" role="status">${t(actor, a.learner === actor.id ? 'Your progress on this course was reset' : 'Progress was reset')} ${t(actor, '{date} by {name}: {reason}', { date: when(latestReset.resetAt, zone, zone, actor.locale), name: latestReset.resetByName, reason: latestReset.reason })} ${t(actor, 'Lessons start again from the first one, with a fresh set of attempts; the earlier work is kept in the history below.')}</p>` : ''
  const history = view.resets.length ? card(t(actor, 'History before a reset'), view.resets.map(reset => h`<section><h3>${reset.kind === 'move' ? t(actor, 'Moved to a new revision') : t(actor, 'Reset')} ${t(actor, '{date} by {name}', { date: when(reset.resetAt, zone, zone, actor.locale), name: reset.resetByName })}</h3><p>${t(actor, 'Reason:')} ${reset.reason}</p><p class="muted">${t(actor, 'Before it: {lessons} done', { lessons: counted(actor, 'lesson', 'lessons', reset.lessons.length) })}${reset.extraAttempts ? `, ${t(actor, '{attempts} granted', { attempts: counted(actor, 'extra attempt', 'extra attempts', reset.extraAttempts) })}` : ''}.</p>${reset.attempts.length ? rows(reset.attempts.map(attempt => ({ title: h`<a href="/app/attempts/${attempt.id}">${t(actor, '{kind} attempt {n}', { kind: t(actor, attempt.kind === 'quiz' ? 'Quiz' : 'Practical'), n: localeNumber(actor, attempt.number) })}</a>`, meta: `${attempt.kind === 'quiz' ? t(actor, '{score} of {total}', { score: attempt.score, total: attempt.maxScore }) : attempt.closedByReset ? t(actor, 'closed by the reset before a decision') : t(actor, attemptState(attempt.state))}; ${t(actor, 'before the reset')}` }))) : ''}</section>`)) : ''
  const manage = a.learner !== actor.id && (actor.owner || actor.roles.has('manager')) ? a.status === 'open'
    ? h`${card('Due date exception', h`<p>Moves the due date for this person only, with a reason. The earlier due date stays in the history.</p>${form('assignment.due', `/app/learn/${id}`, [hidden('assignment', id), field('New due date', 'dueDate', { type: 'date' }), area('Reason', 'reason')], 'Move the due date', { secondary: true })}`)}${card('Reset progress', h`<p>Starts the lessons again from the first one and gives a fresh set of attempts. Earlier lessons, attempts and evidence stay in this assignment's history; the learner sees why.</p>${form('assignment.reset', `/app/learn/${id}`, [hidden('assignment', id), area('Reason', 'reason')], 'Reset progress', { secondary: true })}`)}`
    : a.status === 'completed' ? card('Assign again', h`<p>A completed assignment is not reset: its completion and certificate stay with revision ${a.revisionNumber}. Assign the course again to train this person once more.</p>${form('assignment.create', `/app/records/${a.learner}`, [hidden('course', a.course), hidden('learners', a.learner), field('Due date', 'dueDate', { type: 'date' })], 'Assign the course again', { secondary: true })}`) : '' : ''
  // A learning administrator's own enrollments carry their window forms (ORG-002, AUTO-009).
  const ownEnrollment = actor.adminUnits.length > 0 && a.assignedBy === actor.id
  const access = a.learner !== actor.id && (actor.owner || actor.roles.has('manager') || ownEnrollment) && (a.status === 'open' || view.access.closesAt) ? accessCard(id, view.access, zone, { owner: actor.owner || ownEnrollment, open: a.status === 'open' }) : ''
  // AUTO-006: the learner reports a blocker; whoever may enroll them defers, exempts or declines it.
  const blockers = a.learner === actor.id ? blockerCard(view, id, zone, actor.locale) : ''
  const exceptions = a.learner !== actor.id && permits(actor, 'enrollment') ? exceptionCard(view, id, zone) : ''
  const completion = view.completion ? card(t(actor, 'Completion'), h`<p><mark class="hl">${t(actor, 'Completed')}</mark> ${when(view.completion.completedAt, a.timezone, zone, actor.locale)} ${t(actor, 'against revision {n}.', { n: localeNumber(actor, a.revisionNumber) })} <a href="/app/certificates/${view.completion.certificate}">${t(actor, 'Certificate')}</a></p>`) : ''
  const body = h`${backLink('/app/learning', t(actor, 'My learning'))}${await courseLanguageNote(env, actor, a.revision)}<h1>${a.courseTitle}</h1>
<p class="subtitle">${t(actor, 'Revision {revision}', { revision: localeNumber(actor, a.revisionNumber) })} · ${t(actor, STATUS[a.status] ?? a.status)} · ${t(actor, 'Due {date}', { date: formatDate(a.dueAt, a.timezone, actor.locale) })}${a.status === 'open' && accessNote(view.access, zone, actor.locale) ? ` · ${accessNote(view.access, zone, actor.locale)}` : ''}${a.learner !== actor.id ? h` · ${t(actor, 'Learner')} ${names.get(a.learner)}` : ''}</p>
${view.dueExceptions.length ? h`<p class="muted">${view.dueExceptions.map(change => t(actor, 'Due date moved from {date} by {name}: {reason}', { date: when(change.previousDueAt, a.timezone, zone, actor.locale), name: change.approvedByName, reason: change.reason })).join(' · ')}</p>` : ''}
${view.blocked ? h`<p class="flash">${t(actor, 'Complete the prerequisite course first; your manager can see this requirement.')}</p>` : ''}
${resetNotice}${exceptionNotice(view, a, zone, actor.locale)}${a.status === 'open' ? accessBanner(view.access, zone, actor.locale) : ''}
${launchable && !view.blocked && resume ? h`<p><a class="button" href="${resume}">${view.lessons.some(lesson => lesson.completed) ? t(actor, 'Resume') : t(actor, 'Start')}</a></p>` : ''}
${completion}${learnerPackages(view.packages, id, launchable && !view.blocked && a.learner === actor.id && !actor.viewAs)}${view.externalTools.length ? card(t(actor, 'External learning tools'), h`${view.externalTools.map(tool => h`<div><h3>${tool.title}</h3><p>${tool.passed ? t(actor, 'Required grade received') : t(actor, 'Required grade: {percent}%', { percent: localeNumber(actor, tool.passPercent) })}. ${t(actor, 'Native lessons and assessment are still required.')}</p>${launchable && !view.blocked && a.learner === actor.id && !actor.viewAs ? h`<form method="post" action="/app/lti/launch">${hidden('assignment', id)}${hidden('resource', tool.resource)}<button type="submit">${t(actor, 'Open {title}', { title: tool.title })}</button></form>` : ''}</div>`)}${launchable && !view.blocked && a.learner === actor.id && !actor.viewAs ? form('lti.reconcile', `/app/learn/${id}`, [hidden('assignment', id)], t(actor, 'Check external results'), { secondary: true }) : ''}`) : ''}
<div class="${view.lessons.length ? 'split' : 'stack'}">${lessons}<div class="stack">${moved}${feedbackCard}${quiz}${surveyCard(id, view, actor)}${practical}${attendance}${practiceCard}${attempts}${history}${access}${blockers}${manage}${exceptions}</div></div>`
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
  const sources = cited.length ? h`<p class="muted source-line">${t(actor, 'Source material:')} ${cited.map((version, n) => h`${n ? ', ' : ''}<a href="/app/files/source/${version.id}">${version.title}, ${t(actor, 'version')} ${localeNumber(actor, version.number)}</a>`)}</p>` : ''
  const action = view.assignment.status === 'open' && view.assignment.learner === actor.id && !view.blocked
    ? form('lesson.complete', next ? `/app/learn/${id}/lessons/${next.id}` : `/app/learn/${id}`, [hidden('assignment', id), hidden('lesson', lesson.id)], lesson.completed ? (next ? t(actor, 'Next lesson') : t(actor, 'Back to course')) : next ? t(actor, 'Mark done and continue') : t(actor, 'Mark done'))
    : ''
  const body = h`${backLink(`/app/learn/${id}`, view.assignment.courseTitle)}<p class="muted">${t(actor, 'Lesson {n} of {total}', { n: index + 1, total: view.lessons.length })}</p><h1>${lesson.title}</h1><article class="card lesson-card"><p class="muted lesson-label">${t(actor, 'Lesson reading')}</p><div class="lesson-body">${await courseLanguageNote(env, actor, view.assignment.revision)}${lessonText(lesson.body, { lead: true })}${renderBlocks(lesson.blocks, (await embedPolicy(env)).hosts, actor.locale)}</div></article>${sources}${action}${view.assignment.learner === actor.id && !actor.viewAs ? h`${feedbackForm(id, lessonId, `/app/learn/${id}/lessons/${lessonId}`, actor.locale)}<p><a href="/app/discussions/${view.assignment.course}?lesson=${lessonId}">${t(actor, 'Ask about this lesson or discuss it')}</a></p>` : ''}`
  return mediaPage(env, page(lesson.title, actor, body, { current: '/app/learning', url }))
}

export async function quizPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const view = await assignmentView(env, actor, id)
  if (!view.quiz || view.assignment.learner !== actor.id) throw new BeamError('not_found', 404)
  requireAccess({ access_opens_at: view.access.opensAt, access_closes_at: view.access.closesAt })
  const quiz = view.quiz, zone = (await business(env))!.timezone
  const intro = h`<p class="subtitle">${t(actor, 'Pass mark {percent}%.', { percent: quiz.passPercent })} ${t(actor, '{n} attempts left.', { n: quiz.attemptsLeft })} ${t(actor, '{questions} worth {points}.', { questions: counted(actor, 'question', 'questions', quiz.questions.length), points: counted(actor, 'point', 'points', quiz.points) })}${quiz.draw ? t(actor, ', drawn from a bank of {n}', { n: quiz.bank }) : ''} ${t(actor, 'Each question earns its points only when every choice, blank, position or pair is right; written answers earn what the assessor awards.')}</p>`
  const back = backLink(`/app/learn/${id}`, view.assignment.courseTitle)
  // LEARN-015: matching questions add their drag-and-drop layer.
  const matching = quiz.questions.some(question => question.kind === 'match') ? ['/beam-match.js'] : []
  // LEARN-018: a timed quiz starts on the server; while it runs the page counts down to the server's deadline.
  if (quiz.timeLimitMinutes) {
    const running = !!quiz.session && view.assignment.status === 'open' && !quiz.passed
    return page(t(actor, 'Timed quiz'), actor, h`${back}<h1>${t(actor, 'Timed quiz')}</h1>${intro}${running ? timedQuiz(id, quiz, zone, Date.now(), actor.locale) : timedStart(id, quiz, actor.locale)}`, { current: '/app/learning', url, script: running ? ['/beam-countdown.js', ...matching] : undefined })
  }
  const body = h`${back}<h1>${t(actor, 'Quiz')}</h1>${intro}<div class="card narrow">${form('quiz.submit', `/app/learn/${id}`, [hidden('assignment', id), questionFields(quiz, {}, actor.locale)], t(actor, 'Submit answers'))}</div>`
  return page(t(actor, 'Quiz'), actor, body, { current: '/app/learning', url, script: matching })
}

export async function practicalPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const view = await assignmentView(env, actor, id)
  if (!view.practical || view.assignment.learner !== actor.id) throw new BeamError('not_found', 404)
  requireAccess({ access_opens_at: view.access.opensAt, access_closes_at: view.access.closesAt })
  const names = await memberNames(env)
  const body = h`${backLink(`/app/learn/${id}`, view.assignment.courseTitle)}<h1>${t(actor, 'Practical assessment')}</h1><div class="narrow">${card(t(actor, 'Instructions'), lessonText(view.practical.instructions ?? ''))}
<section class="card"><p>${t(actor, 'Your evidence goes to {name}, who decides it.', { name: names.get(view.practical.assessor ?? '') ?? '' })}</p>${form('practical.submit', `/app/learn/${id}`, [hidden('assignment', id), area(t(actor, 'What you did'), 'evidence'), fileField(t(actor, 'Evidence file (optional)'), 'file')], t(actor, 'Submit for assessment'), { multipart: true })}</section></div>`
  return page(t(actor, 'Practical assessment'), actor, body, { current: '/app/learning', url })
}

export async function recordPage(env: Bindings, actor: Actor, memberId: string, url: URL) {
  const record = await learnerRecord(env, actor, memberId)
  const zone = (await business(env))!.timezone
  const extraTime = actor.owner || actor.roles.has('manager') ? accommodationCard(memberId, await accommodations(env, memberId), await listCourses(env) as { id: string; title: string }[], zone) : ''
  // ORG-012: the owner, their manager or their unit's learning administrator can open their pages read-only (not a custom
  // role); the server refuses the rest.
  const viewAs = memberId !== actor.id && !actor.viewAs && manages(actor, memberId) ? h`<form method="post" action="/app/view/start">${hidden('learner', memberId)}${hidden('returnTo', `/app/records/${memberId}`)}<button type="submit" class="secondary">View as ${record.member.name}</button></form>` : ''
  const body = h`${backLink(memberId === actor.id ? '/app/learning' : '/app/manage', t(actor, memberId === actor.id ? 'My learning' : 'Manage'))}<h1>${record.member.name}</h1><p class="subtitle">${record.member.email ?? t(actor, 'No work email')} · <a href="/app/records/${memberId}/transcript">${t(actor, 'Transcript')}</a></p>${viewAs}
<section class="card table-card" aria-labelledby="assignments"><h2 class="card-title table-title" id="assignments">${t(actor, 'Assignments')}</h2>${record.assignments.length ? h`<div class="table-wrap"><table class="stacked"><thead><tr><th scope="col">${t(actor, 'Course')}</th><th scope="col">${t(actor, 'Revision')}</th><th scope="col">${t(actor, 'Status')}</th><th scope="col">${t(actor, 'Due')}</th><th scope="col">${t(actor, 'Lessons')}</th></tr></thead><tbody>${record.assignments.map(row => h`<tr><td>${cellLabel(t(actor, 'Course'))}<a href="/app/learn/${row.id}">${row.courseTitle}</a></td><td>${cellLabel(t(actor, 'Revision'))}${localeNumber(actor, row.revisionNumber)}</td><td class="cell-status">${cellLabel(t(actor, 'Status'))}${pill(row.state, statusLabel(row, actor))}</td><td>${cellLabel(t(actor, 'Due'))}${when(row.dueAt, row.timezone, zone, actor.locale)}</td><td>${cellLabel(t(actor, 'Lessons'))}${t(actor, '{done} of {total} lessons', { done: localeNumber(actor, row.lessonsDone), total: localeNumber(actor, row.lessonsTotal) })}</td></tr>`)}</tbody></table></div>` : h`<p class="muted table-empty">${t(actor, 'Nothing assigned.')}</p>`}</section>
${card(t(actor, 'Completions'), record.completions.length ? rows(record.completions.map(row => ({ title: `${row.courseTitle} ${t(actor, 'revision')} ${localeNumber(actor, row.revisionNumber)}`, meta: h`${t(actor, 'Completed')} ${formatDate(row.completedAt, zone, actor.locale)} (${t(actor, METHOD[row.method] ?? row.method)}) · <a href="/app/certificates/${row.certificate}">${t(actor, 'Certificate')}</a>` }))) : h`<p class="muted">${t(actor, 'No completions yet.')}</p>`)}
${historyCredits(actor, record.credits, zone)}
${extraTime}
${await directoryCard(env, actor, memberId, zone)}
${record.history.length ? card(t(actor, 'Imported history'), h`<p class="muted">${t(actor, 'Historical evidence from a previous system, not a Beam assessment.')}</p>${rows(record.history.map(row => ({ title: row.sourceCourseName, meta: `${t(actor, 'completed {date} in {source}', { date: day(row.completedOn, actor.locale), source: row.source })}${row.accepted ? ` · ${t(actor, 'reviewed')}` : ''}` })))}`) : ''}`
  return page(record.member.name, actor, body, { url })
}

export const notFound = (actor: Actor | null) => page(t(actor, 'Not found'), actor, h`<h1>${t(actor, 'Not found')}</h1><p>${t(actor, 'This page is not part of Beam, or you cannot open it.')}</p><p><a href="/app/learning">${t(actor, 'Back to My learning')}</a></p>`, { status: 404 })

/** LEARN-001: the revision's satisfaction survey, optional and never part of passing or completion. */
function surveyCard(id: string, view: Awaited<ReturnType<typeof assignmentView>>, actor: Actor) {
  if (!view.survey.questions.length || view.assignment.learner !== actor.id || actor.viewAs) return ''
  if (view.survey.answered) return card(t(actor, 'Course survey'), h`<p>${t(actor, 'Thank you: your survey answers were recorded without your name.')}</p>`)
  if (!view.lessonsComplete) return card(t(actor, 'Course survey'), h`<p class="muted">${t(actor, 'Available after every lesson is done. It is optional and never affects passing or completion.')}</p>`)
  const fields = view.survey.questions.map(item => item.kind === 'rating'
    ? select(item.prompt, `s_${item.id}`, ['1', '2', '3', '4', '5'].map(value => ({ value, label: value })), '', { required: false, blank: '—' })
    : area(item.prompt, `s_${item.id}`, '', false))
  return card(t(actor, 'Course survey'), h`<p class="muted">${t(actor, 'Optional. Answers are kept without your name and never affect passing or completion.')}</p>${form('survey.answer', `/app/learn/${id}`, [hidden('assignment', id), ...fields], t(actor, 'Send survey'))}`)
}

async function courseLanguageNote(env: Bindings, actor: Actor, revision: string) {
 const original = await localeRevisionLanguage(env, revision)
 if (original.toLowerCase().split('-')[0] === (actor.locale ?? 'en-US').split('-')[0]) return ''
 return card(t(actor, 'Language fallback'), h`<p>${t(actor, 'A reviewed {language} version is not available. This course opens in its original language ({original}).', { language: t(actor, actor.locale === 'es-US' ? 'Spanish' : 'English'), original })}</p>`)
}
