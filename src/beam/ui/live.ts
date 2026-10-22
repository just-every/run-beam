import { t, localeNumber } from '../messages'
// LIVE-001 on the page: the learner's agenda (with every reschedule, change and cancellation since they registered and
// the calendar file), the session options of their assigned courses behind the prerequisite gate, the sessions a person
// leads, and scheduling, rescheduling, changing and cancelling sessions for whoever schedules them.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import type { Row } from '../core'
import { FORMATS, MAX_MEETINGS, sessionsView } from '../live'
import { ORDERS, POLICIES } from '../registrations'
import { all } from '../core'
import { formatClock, formatDay, formatInstant, zoneName } from '../time'
import { area, card, field, form, h, hidden, page, rows, select } from './html'

const FORMAT: Record<string, string> = { classroom: 'Classroom', virtual: 'Virtual' }
const REPEAT: Record<string, string> = { none: 'Once', daily: 'Every day', weekly: 'Every week' }
const POLICY: Record<string, string> = { offer: 'Offer it to the next person on the waitlist', assign: 'Give it to the next person on the waitlist' }
const ORDER: Record<string, string> = { joined: 'In the order people joined', due: 'Soonest due assignment first, then joining order' }
const EVENT: Record<string, string> = { registered: 'Registered', waitlisted: 'Joined the waitlist', offered: 'Offered a seat', accepted: 'Accepted the seat', assigned: 'Moved from the waitlist into the session', declined: 'Declined the seat', offer_expired: 'Seat offer expired', withdrawn: 'Left the waitlist', left: 'Left the session', switched: 'Switched to another session', closed: 'Waitlist place closed' }

/** LIVE-002: seats taken (registered plus open offers), the waitlist and the registration deadline. */
const seatLine = (session: Row, home: string, actor: Actor) => [session.capacity === null ? t(actor, '{n} registered', { n: localeNumber(actor, session.registered) }) : t(actor, '{taken} of {total} seats taken', { taken: localeNumber(actor, session.registered + session.offered), total: localeNumber(actor, session.capacity) }), session.waiting ? t(actor, '{n} waiting', { n: localeNumber(actor, session.waiting) }) : '', session.closesAt ? t(actor, 'registration closes {date}', { date: formatInstant(session.closesAt, session.timezone, home, actor.locale) }) : ''].filter(Boolean).join(' · ')

function seatFields(session: Row | null) {
  return [field('Seats (blank: unlimited)', 'capacity', { type: 'number', value: session?.capacity ?? '', required: false }), field('Registration closes on (optional)', 'closesDate', { type: 'date', value: '', required: false }), field('at (time, session zone)', 'closesTime', { type: 'time', value: '', required: false }),
    select('When a seat opens', 'policy', POLICIES.map(value => ({ value, label: POLICY[value] })), session?.policy ?? 'offer'), field('An offer lasts (hours)', 'offerHours', { type: 'number', value: session?.offerHours ?? 24 }),
    select('Waitlist order', 'order', ORDERS.map(value => ({ value, label: ORDER[value] })), session?.waitlistOrder ?? 'joined')]
}

/** Each meeting at its wall-clock time in the session's zone, the zone named when it is not the business's. */
const times = (session: Row, home: string, actor: Actor) => session.meetings.map((meeting: Row) => `${formatInstant(meeting.startsAt, session.timezone, home, actor.locale)}–${formatClock(meeting.endsAt, session.timezone, actor.locale)}`).join('; ')
const place = (session: Row, actor: Actor) => session.format === 'virtual' ? h`${t(actor, 'Virtual')}${session.location ? ` · ${session.location}` : ''}${session.joinUrl ? h` · <a href="${session.joinUrl}" rel="noopener noreferrer">${t(actor, 'Join link')}</a>` : ''}` : h`${session.location}`

function describeChange(item: Row, home: string, actor: Actor) {
  if (item.kind === 'cancelled') return t(actor, 'Cancelled: {reason}', { reason: item.detail.reason })
  if (item.kind === 'updated') return t(actor, 'Changed ({fields}) on {date}', { fields: item.detail.changed.map((key: string) => t(actor, ({ joinUrl: 'Join link', instructor: 'Instructor', location: 'Location', materials: 'Materials and preparation', title: 'Title', format: 'Format' } as Record<string, string>)[key] ?? key)).join(', '), date: formatInstant(item.at, home, home, actor.locale) })
  const { from, to } = item.detail
  return t(actor, 'Rescheduled on {date}: was {from}, now {to}', { date: formatInstant(item.at, home, home, actor.locale), from: `${formatDay(from.date, actor.locale)} ${from.time} ${zoneName(from.timezone, actor.locale)}`, to: `${formatDay(to.date, actor.locale)} ${to.time} ${zoneName(to.timezone, actor.locale)}` })
}

function summary(session: Row, home: string, actor: Actor, extra: unknown = '') {
  return h`${t(actor, session.format === 'virtual' ? 'Virtual' : 'Classroom')} · ${times(session, home, actor)}<br>${place(session, actor)}${session.instructorName ? ` · ${t(actor, 'Instructor: {name}', { name: session.instructorName })}` : ''}${session.materials ? h`<br>${t(actor, 'Materials: {text}', { text: session.materials })}` : ''}${extra}`
}

const calendarLink = (session: Row, actor: Actor, cancelled = false) => h`<a href="/app/sessions/${session.id}/calendar.ics">${t(actor, cancelled ? 'Calendar cancellation (.ics)' : 'Add to calendar (.ics)')}</a>`

function whenFields(session: Row | null, zone: string) {
  return [field('First date', 'date', { type: 'date', value: session?.startDate ?? '' }), field('Start time', 'time', { type: 'time', value: session?.startTime ?? '09:00' }), field('Minutes', 'minutes', { type: 'number', value: session?.minutes ?? 60 }),
    field('Time zone (IANA, for example America/New_York)', 'timezone', { value: session?.timezone ?? zone })]
}

function detailFields(session: Row | null, members: Row[]) {
  return [field('Title', 'title', { value: session?.title ?? '' }), select('Format', 'format', FORMATS.map(value => ({ value, label: FORMAT[value] })), session?.format ?? 'classroom'),
    field('Location (room or address; optional for virtual)', 'location', { value: session?.location ?? '', required: false }), field('Join link (https, virtual sessions)', 'joinUrl', { type: 'url', value: session?.joinUrl ?? '', required: false }),
    select('Instructor', 'instructor', members.map(member => ({ value: member.id, label: member.name })), session?.instructor ?? '', { required: false, blank: 'None named' }), area('Materials and preparation', 'materials', session?.materials ?? '', false)]
}

export async function sessionsPage(env: Bindings, actor: Actor, url: URL) {
  const view = await sessionsView(env, actor)
  const home = actor.shell!.zone
  const agenda = card(t(actor, 'My agenda'), view.agenda.length ? rows(view.agenda.map(session => ({
    title: h`${session.title} — ${session.courseTitle}${session.state === 'cancelled' ? h` · <strong>${t(actor, 'Cancelled')}</strong>` : ''}`,
    meta: summary(session, home, actor, h`${session.changes.map((item: Row) => h`<br><strong>${describeChange(item, home, actor)}</strong>`)}${session.changes.length && session.state !== 'cancelled' ? h`<br>${t(actor, 'Download the calendar file again to update your calendar.')}` : ''}<br>${calendarLink(session, actor, session.state === 'cancelled')}`),
    aside: session.state === 'scheduled' ? form('session.leave', '/app/sessions', [hidden('session', session.id)], t(actor, 'Leave session'), { secondary: true }) : '',
  }))) : h`<p class="muted">${t(actor, 'You are not registered for any session.')}</p>`, { id: 'agenda' })
  const zoneOf = (row: Row) => row.timezone
  const waits = view.waits.length ? card(t(actor, 'Waitlist and seat offers'), rows(view.waits.map((wait: Row) => wait.state === 'offered' ? {
    title: h`${wait.title} — ${wait.courseTitle}`, meta: t(actor, 'A seat is offered to you until {date}. If you do not accept it by then, it passes to the next person.', { date: formatInstant(wait.offerExpiresAt, zoneOf(wait), home, actor.locale) }),
    aside: h`${form('session.accept', '/app/sessions', [hidden('session', wait.session)], t(actor, 'Accept the seat'))}${form('session.leave', '/app/sessions', [hidden('session', wait.session)], t(actor, 'Decline'), { secondary: true })}`,
  } : { title: h`${wait.title} — ${wait.courseTitle}`, meta: t(actor, 'On the waitlist, place {n}', { n: localeNumber(actor, wait.position) }), aside: form('session.leave', '/app/sessions', [hidden('session', wait.session)], t(actor, 'Leave the waitlist'), { secondary: true }) })), { id: 'waits' }) : ''
  const history = view.history.length ? card(t(actor, 'Your session history'), rows(view.history.map((item: Row) => ({ title: item.title, meta: `${t(actor, EVENT[item.kind] ?? item.kind)} · ${formatInstant(item.at, home, home, actor.locale)}` }))), { id: 'history' }) : ''
  const options = view.options.map(option => card(t(actor, 'Choose a session: {course}', { course: option.courseTitle }), h`${option.blocked ? h`<p class="flash" role="status">${t(actor, 'Complete {course} first; then you can choose a session.', { course: option.blocked.prerequisiteTitle })}</p>` : ''}${rows(option.sessions.map((session: Row) => {
    const mine = view.agenda.some(item => item.id === session.id)
    const waiting = view.waits.some((item: Row) => item.session === session.id), closed = session.closesAt !== null && session.closesAt <= actor.shell!.now
    const choose = session.full ? t(actor, 'Join the waitlist') : view.agenda.some(item => item.course === option.course) ? t(actor, 'Switch to this session') : t(actor, 'Choose this session')
    return { title: session.title, meta: summary(session, home, actor, h`<br>${seatLine(session, home, actor)}`), aside: mine ? h`<span class="muted">${t(actor, 'Registered')}</span>` : waiting ? h`<span class="muted">${t(actor, 'On the waitlist')}</span>` : closed ? h`<span class="muted">${t(actor, 'Registration closed')}</span>` : option.blocked ? '' : form('session.register', '/app/sessions', [hidden('session', session.id)], choose, { secondary: true }) }
  }))}`, { id: `options-${option.course}` }))
  const leading = view.leading.length ? card('Sessions you lead', rows(view.leading.map(session => ({ title: h`${session.title} — ${session.courseTitle}${session.state === 'cancelled' ? ' · Cancelled' : ''}`, meta: summary(session, home, actor, h` · ${session.registered} registered<br>${calendarLink(session, actor, session.state === 'cancelled')} · <a href="/app/sessions/${session.id}/roster">Roster and attendance</a>`) }))), { id: 'leading' }) : ''
  let manage: unknown = ''
  if (view.courses.length || view.managed.length) {
    const members = await all(env, 'SELECT id, name FROM beam_members ORDER BY name')
    const schedule = card('Schedule a session', form('session.schedule', '/app/sessions', [select('Course', 'course', view.courses.map(course => ({ value: course.id, label: course.title }))), ...detailFields(null, members), ...whenFields(null, home),
      select('Repeats', 'repeat', Object.entries(REPEAT).map(([value, label]) => ({ value, label })), 'none'), field(`Meetings in the series (1–${MAX_MEETINGS})`, 'count', { type: 'number', value: 1, required: false }), ...seatFields(null)], 'Schedule session'), { id: 'schedule' })
    const managed = view.managed.length ? card('Scheduled sessions', rows(view.managed.map(session => ({
      title: h`${session.title} — ${session.courseTitle}${session.state === 'cancelled' ? h` · <strong>Cancelled: ${session.cancelReason}</strong>` : ''}`,
      meta: h`${summary(session, home, actor, h` · ${REPEAT[session.repeat]}, ${session.meetingCount} ${session.meetingCount === 1 ? 'meeting' : 'meetings'} · ${seatLine(session, home, actor)} · ${calendarLink(session, actor, session.state === 'cancelled')} · <a href="/app/sessions/${session.id}/roster">Roster and attendance</a>`)}${session.history.length ? h`
<details><summary>Roster history</summary>${rows(session.history.map((item: Row) => ({ title: item.learnerName, meta: `${t(actor, EVENT[item.kind] ?? item.kind)} · ${formatInstant(item.at, home, home, actor.locale)}` })))}</details>` : ''}${session.state === 'scheduled' ? h`
<details><summary>Reschedule</summary>${form('session.reschedule', '/app/sessions', [hidden('session', session.id), ...whenFields(session, home)], 'Reschedule')}</details>
<details><summary>Change details</summary>${form('session.update', '/app/sessions', [hidden('session', session.id), ...detailFields(session, members)], 'Save changes')}</details>
<details><summary>Seats and waitlist</summary>${form('session.seats', '/app/sessions', [hidden('session', session.id), ...seatFields(session)], 'Save seats')}</details>
<details><summary>Cancel the session</summary>${form('session.cancel', '/app/sessions', [hidden('session', session.id), field('Reason', 'reason')], 'Cancel session', { secondary: true })}</details>` : ''}`,
    }))), { id: 'managed' }) : ''
    manage = h`${view.courses.length ? schedule : ''}${managed}`
  }
  const body = h`<h1>${t(actor, 'Sessions')}</h1><p class="lede">${t(actor, 'Classroom and virtual sessions of your courses. Choose one session per course (when one is full, join its waitlist); your agenda shows each meeting in the session’s own time zone, and every change to a session you chose. Calendar files are downloads for your calendar; Beam does not email invitations yet.')}</p>
${waits}${agenda}${options}${history}${leading}${manage}`
  return page(t(actor, 'Sessions'), actor, body, { current: '/app/sessions', url })
}
