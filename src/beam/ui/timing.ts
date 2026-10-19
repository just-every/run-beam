// LEARN-018 on the pages: starting and taking a timed quiz with its countdown,
// the time facts on an attempt, and a manager's extra-time accommodations.
import type { Accommodation } from '../timing'
import { card, field, form, h, hidden, rows, select, when, type Html } from './html'

export const accommodationLabel = (row: Pick<Accommodation, 'kind' | 'amount' | 'course'>, courseTitle?: string) =>
  `${row.kind === 'percent' ? `${row.amount}% extra time` : `${row.amount} extra ${row.amount === 1 ? 'minute' : 'minutes'}`} ${row.course ? `on ${courseTitle ?? 'this course'}` : 'on every timed assessment'}`

interface Quiz { passPercent: number; attemptsLeft: number; timeLimitMinutes?: number | null; extraMinutes?: number; accommodation?: Accommodation | null; session?: { deadline: number; extraMinutes: number; answers: Record<string, number[]> } | null; questions: { id: string; prompt: string; choices: string[]; multiple: boolean }[] }

export const questionFields = (quiz: Quiz, answers: Record<string, number[]> = {}) => quiz.questions.map((question, n) => h`<fieldset><legend>${n + 1}. ${question.prompt}${question.multiple ? h` <span class="muted">(choose all that apply)</span>` : ''}</legend>${question.choices.map((choice, index) => h`<label class="check"><input type="${question.multiple ? 'checkbox' : 'radio'}" name="q_${question.id}" value="${index}"${answers[question.id]?.includes(index) ? h` checked` : ''}> ${choice}</label>`)}</fieldset>`)

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
