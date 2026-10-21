import { message } from '../messages'
import type { Language } from '../language'
// LEARN-018 on the pages: starting and taking a timed quiz with its countdown,
// the time facts on an attempt, and a manager's extra-time accommodations.
import type { Accommodation } from '../timing'
import type { Answer, PresentedQuestion } from '../question-types'
import { area, card, field, form, h, hidden, rows, select, when, type Html } from './html'

export const accommodationLabel = (row: Pick<Accommodation, 'kind' | 'amount' | 'course'>, courseTitle?: string) =>
  `${row.kind === 'percent' ? `${row.amount}% extra time` : `${row.amount} extra ${row.amount === 1 ? 'minute' : 'minutes'}`} ${row.course ? `on ${courseTitle ?? 'this course'}` : 'on every timed assessment'}`

interface Quiz { passPercent: number; attemptsLeft: number; timeLimitMinutes?: number | null; extraMinutes?: number; accommodation?: Accommodation | null; session?: { deadline: number; extraMinutes: number; answers: Record<string, Answer> } | null; questions: PresentedQuestion[] }

/** One fieldset per question; each blank, position and pair is its own labelled control, so every type works by
 * keyboard and screen reader on any screen (LEARN-015, LEARN-011). */
export const questionFields = (quiz: Quiz, answers: Record<string, Answer> = {}, locale: Language = 'en-US') => quiz.questions.map((question, n) => {
  const given = answers[question.id] ?? []
  // LEARN-001: a written answer goes to the named assessor.
  if (question.kind === 'text') return h`<fieldset><legend>${n + 1}. ${question.prompt} <span class="muted">(written answer, ${question.points} ${question.points === 1 ? 'point' : 'points'}, graded by the assessor)</span></legend>${area(message(locale, 'Your answer'), `q_${question.id}`, typeof given[0] === 'string' ? given[0] : '', false)}</fieldset>`
  if (question.kind === 'blank') return h`<fieldset><legend>${n + 1}. ${question.prompt} <span class="muted">(fill in ${question.blanks === 1 ? 'the blank' : question.blanks === 2 ? 'both blanks' : `all ${question.blanks} blanks`})</span></legend>${Array.from({ length: question.blanks }, (_, part) => field(message(locale, 'Blank {n}', { n: part + 1 }), `q_${question.id}_${part}`, { value: given[part] ?? '', required: false }))}</fieldset>`
  const options = question.kind === 'order' || question.kind === 'match' ? question.options.map(option => ({ value: String(option.index), label: option.label })) : []
  const chosen = (part: number) => typeof given[part] === 'number' && given[part] !== -1 ? String(given[part]) : ''
  if (question.kind === 'order') return h`<fieldset><legend>${n + 1}. ${question.prompt} <span class="muted">(${message(locale, 'put the items in order')})</span></legend>${Array.from({ length: question.positions }, (_, part) => select(message(locale, 'Position {n}', { n: part + 1 }), `q_${question.id}_${part}`, options, chosen(part), { required: false, blank: '—' }))}</fieldset>`
  // Matching also takes drag-and-drop where scripts run (public/beam-match.js); the selects stay the door.
  if (question.kind === 'match') return h`<fieldset data-match><legend>${n + 1}. ${question.prompt} <span class="muted">(${message(locale, 'match each item')})</span></legend>${question.lefts.map((left, part) => h`<div class="match-pair">${select(left, `q_${question.id}_${part}`, options, chosen(part), { required: false, blank: '—' })}</div>`)}</fieldset>`
  return h`<fieldset><legend>${n + 1}. ${question.prompt}${question.multiple ? h` <span class="muted">(${message(locale, 'choose all that apply')})</span>` : ''}</legend>${question.choices.map((choice, index) => h`<label class="check"><input type="${question.multiple ? 'checkbox' : 'radio'}" name="q_${question.id}" value="${index}"${(given as number[]).includes(index) ? h` checked` : ''}> ${choice}</label>`)}</fieldset>`
})

/** Before the attempt starts: the limit, any extra time and what happens when time runs out. */
export function timedStart(id: string, quiz: Quiz) {
  const extra = quiz.extraMinutes ? ` plus ${quiz.extraMinutes} minutes extra time (${accommodationLabel(quiz.accommodation!)}, granted by ${quiz.accommodation!.grantedByName})` : ''
  return h`<div class="card narrow"><p>You have ${quiz.timeLimitMinutes} minutes${extra}. The time starts when you press Start and keeps running if you leave this page or lose your connection.</p><p>Save your answers as you go: when the time runs out, only saved answers are scored and later answers are refused.</p>${form('quiz.start', `/app/learn/${id}/quiz`, [hidden('assignment', id)], 'Start the timed quiz')}</div>`
}

/** The running attempt: the server's deadline as a countdown, saved answers checked, and Save or Submit. */
export function timedQuiz(id: string, quiz: Quiz, zone: string, at: number) {
  const session = quiz.session!
  const minutes = Math.max(0, Math.ceil((session.deadline - at) / 60_000))
  return h`<p class="flash countdown" data-deadline="${session.deadline}" data-now="${at}"><strong>Time left: <span data-left aria-hidden="true">${minutes} min</span></strong> · ends ${when(session.deadline, zone)}${session.extraMinutes ? ` · includes ${session.extraMinutes} minutes extra time` : ''}</p><p id="time-status" role="status" aria-live="assertive"></p>
<div class="card narrow"><form method="post" action="/app/do/quiz.submit">${hidden('assignment', id)}${questionFields(quiz, session.answers)}<button type="submit" name="returnTo" value="/app/learn/${id}">Submit answers</button> <button type="submit" class="secondary" formaction="/app/do/quiz.save" name="returnTo" value="/app/learn/${id}/quiz">Save answers</button></form></div>`
}

/** On an attempt: its limit, extra time with who granted it, and when it actually started and closed. */
export function timingCard(timing: { timeLimitMinutes: number; extraMinutes: number; accommodation: Accommodation | null; startedAt: number; closedAt: number; closeReason: string } | null, zone: string): Html | '' {
  if (!timing) return ''
  const extra = timing.extraMinutes ? h`<p>Extra time: ${timing.extraMinutes} minutes${timing.accommodation ? ` (${accommodationLabel(timing.accommodation)}, granted by ${timing.accommodation.grantedByName} ${when(timing.accommodation.grantedAt, zone)})` : ''}.</p>` : ''
  return card('Time', h`<p>Time limit: ${timing.timeLimitMinutes} minutes.</p>${extra}<p>Started ${when(timing.startedAt, zone)}; closed ${when(timing.closedAt, zone)} ${timing.closeReason === 'expired' ? 'when the time ran out, with the answers saved before it' : 'on submission'}.</p>`)
}

/** On a person's record, for managers: their extra-time accommodations and the form to grant one. */
export function accommodationCard(member: string, granted: Accommodation[], courses: { id: string; title: string }[], zone: string) {
  const title = (course: string | null) => courses.find(row => row.id === course)?.title
  return card('Extra time on timed assessments', h`${granted.length ? rows(granted.map(row => ({ title: accommodationLabel(row, title(row.course)), meta: `granted by ${row.grantedByName} ${when(row.grantedAt, zone)}${row.note ? ` · ${row.note}` : ''}` }))) : h`<p class="muted">None granted.</p>`}
<details><summary>Grant extra time</summary>${form('accommodation.grant', `/app/records/${member}`, [hidden('learner', member), select('Applies to', 'course', courses.map(course => ({ value: course.id, label: course.title })), '', { required: false, blank: 'Every timed assessment' }), select('Kind', 'kind', [{ value: 'percent', label: 'Percentage of the time limit' }, { value: 'minutes', label: 'Minutes' }]), field('Amount', 'amount', { type: 'number', value: 50 }), field('Note', 'note', { required: false })], 'Grant extra time', { secondary: true })}</details>`)
}
