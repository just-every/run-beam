// LIVE-003 on the page: a session's roster for its instructor and whoever schedules it. Each registered learner shows
// what their assignment still needs, the current attendance record with a form to record or amend it, and the timeline
// of every record and amendment.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import type { Row } from '../core'
import { roster, STATUSES } from '../attendance'
import { formatInstant } from '../time'
import { area, backLink, card, field, form, h, hidden, page, rows, select } from './html'

const STATUS: Record<string, string> = { attended: 'Attended', partial: 'Partly attended', absent: 'Absent' }
const DECISION: Record<string, string> = { complete: 'Completed the session', incomplete: 'Did not complete the session' }

const describe = (record: Row) => `${STATUS[record.status]}, ${record.minutes} min · ${DECISION[record.decision]}${record.note ? ` · ${record.note}` : ''}`

function fields(scheduled: number, record: Row | null) {
  return [select('Attendance', 'status', STATUSES.map(value => ({ value, label: STATUS[value] })), record?.status ?? 'attended'), field(`Minutes attended, if partly (of ${scheduled})`, 'minutes', { type: 'number', value: record?.status === 'partial' ? record.minutes : '', required: false }),
    select('Decision', 'decision', Object.entries(DECISION).map(([value, label]) => ({ value, label })), record?.decision ?? 'complete'), area('Note', 'note', '', false), field('Evidence file (optional)', 'file', { type: 'file', required: false })]
}

/** What the learner's assignment still needs; a blended path's other courses are separate assignments. */
function needs(person: Row) {
  if (person.completion) return 'Course completed'
  const left = [person.lessonsDone < person.lessonsTotal ? `lessons ${person.lessonsDone} of ${person.lessonsTotal}` : '', person.attendance.required !== null && !person.attendance.met ? `attendance (${person.attendance.required}% of the session)` : ''].filter(Boolean)
  return left.length ? `Still outstanding: ${left.join(', ')}` : person.attendance.required === null ? 'Revision does not require attendance; attendance does not complete it' : 'All requirements met'
}

export async function rosterPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const view = await roster(env, actor, id)
  const home = actor.shell!.zone, back = `/app/sessions/${id}/roster`
  const learners = view.learners.map(person => card(person.learnerName, h`<p class="muted">Revision ${person.revisionNumber} · ${needs(person)}</p>
${person.current ? h`<p>${describe(person.current)} — ${person.current.recordedByName}, ${formatInstant(person.current.recordedAt, home)}${person.current.attachment ? h` · <a href="/app/files/attachment/${person.current.attachment}">Evidence</a>` : ''}</p>` : h`<p class="muted">No attendance recorded.</p>`}
${!view.session.started ? '' : person.current ? h`<details><summary>Amend</summary>${form('attendance.amend', back, [hidden('attendance', person.current.id), ...fields(view.session.scheduled, person.current), field('Reason for the correction', 'reason')], 'Record amendment', { multipart: true })}</details>`
  : form('attendance.record', back, [hidden('session', id), hidden('learner', person.learner), ...fields(view.session.scheduled, null)], 'Record attendance', { multipart: true })}
${person.timeline.length ? h`<details><summary>Timeline</summary>${rows(person.timeline.map((item: Row) => ({ title: describe(item), meta: `${item.amends ? `Amendment: ${item.reason}` : 'Recorded'} by ${item.recordedByName}, ${formatInstant(item.recordedAt, home)}${item.supersededAt ? ' · superseded' : ''}` })))}</details>` : ''}`, { level: 3 }))
  const body = h`${backLink('/app/sessions', 'Sessions')}<h1>Roster: ${view.session.title}</h1><p class="lede">${view.session.courseTitle} · ${view.session.scheduled} scheduled minutes. ${view.session.started ? 'Record each person’s attendance; corrections are amendments with a reason, and earlier records stay in the timeline.' : `Attendance opens when the session begins (${formatInstant(view.session.first, view.session.timezone, home)}).`} Attendance completes a course only when its reviewed revision requires attendance and its lessons and assessment are also done.</p>
${learners.length ? learners : h`<p class="muted">Nobody is registered.</p>`}`
  return page('Roster', actor, body, { current: '/app/sessions', url })
}
