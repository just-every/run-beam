import { message } from '../messages'
import type { Language } from '../language'
import { formatInstant } from '../time'
// LEARN-018 on the pages: starting and taking a timed quiz with its countdown,
// the time facts on an attempt, and a manager's extra-time accommodations.
import type { Accommodation } from '../timing'
import type { Answer, PresentedQuestion } from '../question-types'
import { area, card, field, form, h, hidden, rows, select, when, type Html } from './html'

export const accommodationLabel = (row: Pick<Accommodation, 'kind' | 'amount' | 'course'>, courseTitle?: string, locale: Language = 'en-US') => {
  const amount = new Intl.NumberFormat(locale).format(row.amount)
  return message(locale, '{amount} {scope}', { amount: message(locale, row.kind === 'percent' ? '{n}% extra time' : '{n} extra minutes', { n: amount }), scope: row.course ? message(locale, 'on {course}', { course: courseTitle ?? message(locale, 'this course') }) : message(locale, 'on every timed assessment') })
}

interface Quiz { passPercent: number; attemptsLeft: number; timeLimitMinutes?: number | null; extraMinutes?: number; accommodation?: Accommodation | null; session?: { deadline: number; extraMinutes: number; answers: Record<string, Answer> } | null; questions: PresentedQuestion[] }

/** One fieldset per question; each blank, position and pair is its own labelled control, so every type works by
 * keyboard and screen reader on any screen (LEARN-015, LEARN-011). */
export const questionFields = (quiz: Quiz, answers: Record<string, Answer> = {}, locale: Language = 'en-US') => quiz.questions.map((question, n) => {
  const given = answers[question.id] ?? []
  // LEARN-001: a written answer goes to the named assessor.
  if (question.kind === 'text') return h`<fieldset><legend>${n + 1}. ${question.prompt} <span class="muted">(${message(locale, 'written answer, {points} points, graded by the assessor', { points: new Intl.NumberFormat(locale).format(question.points) })})</span></legend>${area(message(locale, 'Your answer'), `q_${question.id}`, typeof given[0] === 'string' ? given[0] : '', false)}</fieldset>`
  if (question.kind === 'blank') return h`<fieldset><legend>${n + 1}. ${question.prompt} <span class="muted">(${message(locale, question.blanks === 1 ? 'fill in the blank' : 'fill in {n} blanks', { n: new Intl.NumberFormat(locale).format(question.blanks) })})</span></legend>${Array.from({ length: question.blanks }, (_, part) => field(message(locale, 'Blank {n}', { n: part + 1 }), `q_${question.id}_${part}`, { value: given[part] ?? '', required: false }))}</fieldset>`
  const options = question.kind === 'order' || question.kind === 'match' ? question.options.map(option => ({ value: String(option.index), label: option.label })) : []
  const chosen = (part: number) => typeof given[part] === 'number' && given[part] !== -1 ? String(given[part]) : ''
  if (question.kind === 'order') return h`<fieldset><legend>${n + 1}. ${question.prompt} <span class="muted">(${message(locale, 'put the items in order')})</span></legend>${Array.from({ length: question.positions }, (_, part) => select(message(locale, 'Position {n}', { n: part + 1 }), `q_${question.id}_${part}`, options, chosen(part), { required: false, blank: '—' }))}</fieldset>`
  // Matching also takes drag-and-drop where scripts run (public/beam-match.js); the selects stay the door.
  if (question.kind === 'match') return h`<fieldset data-match><legend>${n + 1}. ${question.prompt} <span class="muted">(${message(locale, 'match each item')})</span></legend>${question.lefts.map((left, part) => h`<div class="match-pair">${select(left, `q_${question.id}_${part}`, options, chosen(part), { required: false, blank: '—' })}</div>`)}</fieldset>`
  return h`<fieldset><legend>${n + 1}. ${question.prompt}${question.multiple ? h` <span class="muted">(${message(locale, 'choose all that apply')})</span>` : ''}</legend>${question.choices.map((choice, index) => h`<label class="check"><input type="${question.multiple ? 'checkbox' : 'radio'}" name="q_${question.id}" value="${index}"${(given as number[]).includes(index) ? h` checked` : ''}> ${choice}</label>`)}</fieldset>`
})

/** Before the attempt starts: the limit, any extra time and what happens when time runs out. */
export function timedStart(id: string, quiz: Quiz, locale: Language = 'en-US') {
  const tr = (key: string, values = {}) => message(locale, key, values)
  const n = (value: number) => new Intl.NumberFormat(locale).format(value)
  const extra = quiz.extraMinutes ? tr(' plus {minutes} minutes extra time ({accommodation}, granted by {name})', { minutes: n(quiz.extraMinutes), accommodation: accommodationLabel(quiz.accommodation!, undefined, locale), name: quiz.accommodation!.grantedByName }) : ''
  return h`<div class="card narrow"><p>${tr('You have {minutes} minutes{extra}. The time starts when you press Start and keeps running if you leave this page or lose your connection.', { minutes: n(quiz.timeLimitMinutes!), extra })}</p><p>${tr('Save your answers as you go: when the time runs out, only saved answers are scored and later answers are refused.')}</p>${form('quiz.start', `/app/learn/${id}/quiz`, [hidden('assignment', id)], tr('Start the timed quiz'))}</div>`
}

/** The running attempt: the server's deadline as a countdown, saved answers checked, and Save or Submit. */
export function timedQuiz(id: string, quiz: Quiz, zone: string, at: number, locale: Language = 'en-US') {
  const session = quiz.session!, tr = (key: string, values = {}) => message(locale, key, values)
  const n = (value: number) => new Intl.NumberFormat(locale).format(value)
  const minutes = Math.max(0, Math.ceil((session.deadline - at) / 60_000))
  return h`<p class="flash countdown" data-deadline="${session.deadline}" data-now="${at}" data-warning-five="${tr('Five minutes left. Save your answers.')}" data-warning-one="${tr('One minute left. Save your answers now.')}" data-expired="${tr('Time is up. Only the answers you saved are scored.')}" data-locale="${locale}"><strong>${tr('Time left:')} <span data-left aria-hidden="true">${n(minutes)} ${tr('min')}</span></strong> · ${tr('ends {date}', { date: formatInstant(session.deadline, zone, zone, locale) })}${session.extraMinutes ? tr(' · includes {n} minutes extra time', { n: n(session.extraMinutes) }) : ''}</p><p id="time-status" role="status" aria-live="assertive"></p>
<div class="card narrow"><form method="post" action="/app/do/quiz.submit">${hidden('assignment', id)}${questionFields(quiz, session.answers, locale)}<button type="submit" name="returnTo" value="/app/learn/${id}">${tr('Submit answers')}</button> <button type="submit" class="secondary" formaction="/app/do/quiz.save" name="returnTo" value="/app/learn/${id}/quiz">${tr('Save answers')}</button></form></div>`
}

/** On an attempt: its limit, extra time with who granted it, and when it actually started and closed. */
export function timingCard(timing: { timeLimitMinutes: number; extraMinutes: number; accommodation: Accommodation | null; startedAt: number; closedAt: number; closeReason: string } | null, zone: string, locale: Language = 'en-US'): Html | '' {
  if (!timing) return ''
  const tr = (key: string, values = {}) => message(locale, key, values)
  const n = (value: number) => new Intl.NumberFormat(locale).format(value)
  const at = (value: number) => formatInstant(value, zone, zone, locale)
  const extra = timing.extraMinutes ? h`<p>${tr('Extra time: {n} minutes', { n: n(timing.extraMinutes) })}${timing.accommodation ? tr(' ({accommodation}, granted by {name} {date})', { accommodation: accommodationLabel(timing.accommodation, undefined, locale), name: timing.accommodation.grantedByName, date: at(timing.accommodation.grantedAt) }) : ''}.</p>` : ''
  return card(tr('Time'), h`<p>${tr('Time limit: {n} minutes.', { n: n(timing.timeLimitMinutes) })}</p>${extra}<p>${tr('Started {start}; closed {end} {reason}.', { start: at(timing.startedAt), end: at(timing.closedAt), reason: tr(timing.closeReason === 'expired' ? 'when the time ran out, with the answers saved before it' : 'on submission') })}</p>`)
}

/** On a person's record, for managers: their extra-time accommodations and the form to grant one. */
export function accommodationCard(member: string, granted: Accommodation[], courses: { id: string; title: string }[], zone: string) {
  const title = (course: string | null) => courses.find(row => row.id === course)?.title
  return card('Extra time on timed assessments', h`${granted.length ? rows(granted.map(row => ({ title: accommodationLabel(row, title(row.course)), meta: `granted by ${row.grantedByName} ${when(row.grantedAt, zone)}${row.note ? ` · ${row.note}` : ''}` }))) : h`<p class="muted">None granted.</p>`}
<details><summary>Grant extra time</summary>${form('accommodation.grant', `/app/records/${member}`, [hidden('learner', member), select('Applies to', 'course', courses.map(course => ({ value: course.id, label: course.title })), '', { required: false, blank: 'Every timed assessment' }), select('Kind', 'kind', [{ value: 'percent', label: 'Percentage of the time limit' }, { value: 'minutes', label: 'Minutes' }]), field('Amount', 'amount', { type: 'number', value: 50 }), field('Note', 'note', { required: false })], 'Grant extra time', { secondary: true })}</details>`)
}
