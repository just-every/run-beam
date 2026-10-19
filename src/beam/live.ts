// LIVE-001: classroom and virtual sessions. The owner (acting as admin), the learning administrator of the course's unit
// (ORG-002) or a custom role with the live sessions permission there (ORG-010) schedules sessions of a course: a
// classroom location or a virtual join link, an instructor, materials, and one meeting or a daily or weekly series at the
// same wall-clock time in the session's IANA zone, so a weekly 9:00 a.m. New York session stays at 9:00 a.m. across a
// daylight-saving change. A learner with an open assignment of the course chooses one of its sessions once the
// assignment's prerequisite (a role path requirement) is complete; choosing another keeps the first as cancelled. Every
// reschedule, change and cancellation bumps the session's iCalendar sequence and is kept as a change the learner's
// agenda shows, and the .ics file (ics.ts) carries it. Choosing a session, seats and waitlists (LIVE-002) are in
// registrations.ts.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { prerequisiteMet } from './learning'
import { FIRST, learnerEvents, myWaits, promote, readSeats, sessionEvents, sweep } from './registrations'
import { requireBusiness } from './people'
import { addDays, validTimezone, zonedInstant } from './time'

export const FORMATS = ['classroom', 'virtual'] as const
export const REPEATS = ['none', 'daily', 'weekly'] as const
const STEP: Record<string, number> = { none: 0, daily: 1, weekly: 7 }
/** A series has at most this many meetings. */
export const MAX_MEETINGS = 26

/** Units where this person schedules sessions: administered units and those of a live sessions custom role. */
const sessionUnits = (actor: Actor) => [...new Set([...actor.adminUnits, ...(actor.grants.live_sessions?.units ?? [])])]

async function requireScheduler(env: Bindings, actor: Actor, course: string) {
  insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id = ?', course), 'course_not_found', 404)
  if (actor.owner) return
  const units = sessionUnits(actor)
  insist(units.length, 'forbidden', 403)
  insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id = ? AND unit_id IN (SELECT value FROM json_each(?))', course, JSON.stringify(units)), 'outside_your_units', 403)
}

/** Whether this person schedules sessions at all (the owner, a unit administrator, a live sessions custom role). */
export const schedules = (actor: Actor) => actor.owner || sessionUnits(actor).length > 0

interface When { date: string; time: string; minutes: number; timezone: string }

function readWhen(input: Input, zone: string): When {
  const timezone = input.text('timezone', { optional: true, max: 64 }) || zone
  insist(validTimezone(timezone), 'invalid_timezone')
  return { date: input.text('date', { max: 10 }), time: input.text('time', { max: 5 }), minutes: input.integer('minutes', { min: 15, max: 720 })!, timezone }
}

/** Each meeting is the same local time on its own date in the session's zone, so its UTC instant follows daylight saving. */
function meetings(when: When, repeat: string, count: number) {
  const list = Array.from({ length: count }, (_, position) => {
    const date = addDays(when.date, position * STEP[repeat])
    const startsAt = zonedInstant(date, when.time, when.timezone)
    return { position, date, startsAt, endsAt: startsAt + when.minutes * 60_000 }
  })
  insist(list[0].startsAt > now(), 'session_in_past')
  return list
}

const meetingRows = (env: Bindings, session: string, list: ReturnType<typeof meetings>) => [
  stmt(env, 'DELETE FROM beam_session_meetings WHERE session_id = ?', session),
  ...list.map(meeting => stmt(env, 'INSERT INTO beam_session_meetings (session_id, position, local_date, starts_at, ends_at) VALUES (?, ?, ?, ?, ?)', session, meeting.position, meeting.date, meeting.startsAt, meeting.endsAt)),
]

async function readDetails(env: Bindings, input: Input) {
  const format = input.text('format')
  insist((FORMATS as readonly string[]).includes(format), 'invalid_format')
  const location = input.text('location', { optional: format === 'virtual', max: 160 })
  const joinUrl = input.text('joinUrl', { optional: format === 'classroom', max: 500 }) || null
  insist(joinUrl === null || /^https:\/\/[^\s]+$/.test(joinUrl), 'invalid_join_url')
  const instructor = input.text('instructor', { optional: true }) || null
  insist(instructor === null || await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', instructor), 'person_not_found', 404)
  return { title: input.text('title', { max: 120 }), format, location, joinUrl, instructor, materials: input.text('materials', { optional: true, max: 2000 }) }
}

export async function scheduleSession(env: Bindings, actor: Actor, input: Input) {
  const course = input.text('course')
  await requireScheduler(env, actor, course)
  const business = await requireBusiness(env)
  const details = await readDetails(env, input)
  const when = readWhen(input, business.timezone)
  const repeat = input.text('repeat', { optional: true }) || 'none'
  insist((REPEATS as readonly string[]).includes(repeat), 'invalid_repeat')
  const count = repeat === 'none' ? 1 : input.integer('count', { min: 1, max: MAX_MEETINGS })!
  const list = meetings(when, repeat, count)
  const seats = readSeats(input, when.timezone, list[0].startsAt)
  const id = newId(), at = now()
  await commit(env, [
    stmt(env, "INSERT INTO beam_sessions (id, course_id, title, format, location, join_url, instructor_id, materials, timezone, start_date, start_time, minutes, repeat, meetings, sequence, state, created_by, created_at, updated_at, capacity, registration_closes_at, waitlist_policy, waitlist_order, offer_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?)",
      id, course, details.title, details.format, details.location, details.joinUrl, details.instructor, details.materials, when.timezone, when.date, when.time, when.minutes, repeat, count, actor.id, at, at, seats.capacity, seats.closesAt, seats.policy, seats.order, seats.offerHours),
    ...meetingRows(env, id, list),
  ], { actor, action: 'session.schedule', subject: id, detail: { course, ...when, repeat, meetings: count, ...seats } })
  return { id }
}

async function managedSession(env: Bindings, actor: Actor, id: string) {
  const session = await one(env, 'SELECT * FROM beam_sessions WHERE id = ?', id)
  insist(session, 'session_not_found', 404)
  await requireScheduler(env, actor, session.course_id)
  insist(session.state === 'scheduled', 'session_cancelled', 409)
  return session
}

const change = (env: Bindings, session: string, kind: string, detail: unknown) =>
  stmt(env, 'INSERT INTO beam_session_changes (id, session_id, at, kind, detail) VALUES (?, ?, ?, ?, ?)', newId(), session, now(), kind, JSON.stringify(detail))

/** Moves the series to a new first date, time, length or zone; the repeat pattern and meeting count stay. */
export async function rescheduleSession(env: Bindings, actor: Actor, input: Input) {
  const session = await managedSession(env, actor, input.text('session'))
  const when = readWhen(input, session.timezone)
  const list = meetings(when, session.repeat, session.meetings)
  const from = { date: session.start_date, time: session.start_time, minutes: session.minutes, timezone: session.timezone }
  await commit(env, [
    stmt(env, 'UPDATE beam_sessions SET start_date = ?, start_time = ?, minutes = ?, timezone = ?, sequence = sequence + 1, updated_at = ? WHERE id = ?', when.date, when.time, when.minutes, when.timezone, now(), session.id),
    ...meetingRows(env, session.id, list),
    change(env, session.id, 'rescheduled', { from, to: when }),
  ], { actor, action: 'session.reschedule', subject: session.id, detail: { from, to: when } })
  return { id: session.id }
}

export async function updateSession(env: Bindings, actor: Actor, input: Input) {
  const session = await managedSession(env, actor, input.text('session'))
  const details = await readDetails(env, input)
  const changed = Object.entries({ title: session.title, format: session.format, location: session.location, joinUrl: session.join_url, instructor: session.instructor_id, materials: session.materials })
    .filter(([key, value]) => (details as Row)[key] !== value).map(([key]) => key)
  insist(changed.length, 'nothing_changed', 409)
  await commit(env, [
    stmt(env, 'UPDATE beam_sessions SET title = ?, format = ?, location = ?, join_url = ?, instructor_id = ?, materials = ?, sequence = sequence + 1, updated_at = ? WHERE id = ?', details.title, details.format, details.location, details.joinUrl, details.instructor, details.materials, now(), session.id),
    change(env, session.id, 'updated', { changed }),
  ], { actor, action: 'session.update', subject: session.id, detail: { changed } })
  return { id: session.id }
}

/** Cancelling keeps the session, its meetings and registrations as history; calendars receive the cancellation. */
export async function cancelSession(env: Bindings, actor: Actor, input: Input) {
  const session = await managedSession(env, actor, input.text('session'))
  const reason = input.text('reason', { max: 500 })
  await commit(env, [
    stmt(env, "UPDATE beam_sessions SET state = 'cancelled', cancel_reason = ?, sequence = sequence + 1, updated_at = ? WHERE id = ?", reason, now(), session.id),
    change(env, session.id, 'cancelled', { reason }),
    stmt(env, "UPDATE beam_session_waitlist SET state = 'closed', ended_at = ? WHERE session_id = ? AND state IN ('waiting', 'offered')", now(), session.id),
  ], { actor, action: 'session.cancel', subject: session.id, detail: { reason } })
  return { id: session.id }
}

/** LIVE-002: capacity, registration deadline, seat policy, offer length and waitlist order. Lowering the capacity never
 * removes anyone registered; raising it passes the new seats to the waitlist at once. */
export async function setSeats(env: Bindings, actor: Actor, input: Input) {
  const session = await managedSession(env, actor, input.text('session'))
  const first = (await one<{ first: number }>(env, `SELECT ${FIRST} AS first FROM beam_sessions s WHERE s.id = ?`, session.id))!.first
  const seats = readSeats(input, session.timezone, first)
  await commit(env, [stmt(env, 'UPDATE beam_sessions SET capacity = ?, registration_closes_at = ?, waitlist_policy = ?, waitlist_order = ?, offer_hours = ?, updated_at = ? WHERE id = ?', seats.capacity, seats.closesAt, seats.policy, seats.order, seats.offerHours, now(), session.id)],
    { actor, action: 'session.seats', subject: session.id, detail: seats })
  await promote(env, session.id)
  return { id: session.id }
}

const SESSION = `SELECT s.id, s.course_id AS course, c.title AS courseTitle, s.title, s.format, s.location, s.join_url AS joinUrl, s.instructor_id AS instructor, i.name AS instructorName,
  s.materials, s.timezone, s.start_date AS startDate, s.start_time AS startTime, s.minutes, s.repeat, s.meetings AS meetingCount, s.sequence, s.state, s.cancel_reason AS cancelReason, s.updated_at AS updatedAt,
  s.capacity, s.registration_closes_at AS closesAt, s.waitlist_policy AS policy, s.waitlist_order AS waitlistOrder, s.offer_hours AS offerHours
  FROM beam_sessions s JOIN beam_courses c ON c.id = s.course_id LEFT JOIN beam_members i ON i.id = s.instructor_id`

async function shape(env: Bindings, rows: Row[], since: (row: Row) => number | null = () => null, roster = false) {
  return await Promise.all(rows.map(async row => {
    const [meetingList, changes, registered, waits, events] = await Promise.all([
      all(env, 'SELECT position, local_date AS date, starts_at AS startsAt, ends_at AS endsAt FROM beam_session_meetings WHERE session_id = ? ORDER BY position', row.id),
      all(env, 'SELECT kind, at, detail FROM beam_session_changes WHERE session_id = ? AND at >= ? ORDER BY at', row.id, since(row) ?? 0),
      one<{ n: number }>(env, "SELECT COUNT(*) AS n FROM beam_session_registrations WHERE session_id = ? AND state = 'registered'", row.id),
      one<{ offered: number; waiting: number }>(env, "SELECT COALESCE(SUM(state = 'offered'), 0) AS offered, COALESCE(SUM(state = 'waiting'), 0) AS waiting FROM beam_session_waitlist WHERE session_id = ?", row.id),
      roster ? sessionEvents(env, row.id) : null,
    ])
    const seats = { registered: registered?.n ?? 0, offered: waits?.offered ?? 0, waiting: waits?.waiting ?? 0 }
    return { ...row, meetings: meetingList, changes: changes.map(item => ({ ...item, detail: JSON.parse(item.detail) })), ...seats, full: row.capacity !== null && seats.registered + seats.offered >= row.capacity,
      ...(events ? { history: events.map(item => ({ ...item, detail: JSON.parse(item.detail) })) } : {}) } as Row
  }))
}

/** The agenda (sessions this person is registered in, including ones since cancelled), the session options for each of
 * their open assignments with a prerequisite gate, the sessions they lead, and those they schedule. */
export async function sessionsView(env: Bindings, actor: Actor) {
  await sweep(env)
  const mine = await all(env, `${SESSION.replace('SELECT s.id', 'SELECT r.registered_at AS registeredAt, s.id')} JOIN beam_session_registrations r ON r.session_id = s.id WHERE r.learner_id = ? AND r.state = 'registered' ORDER BY s.start_date`, actor.id)
  const agenda = await shape(env, mine, row => row.registeredAt)
  const assigned = await all(env, "SELECT a.*, c.title AS courseTitle, p.title AS prerequisiteTitle FROM beam_assignments a JOIN beam_courses c ON c.id = a.course_id LEFT JOIN beam_courses p ON p.id = a.prerequisite_course_id WHERE a.learner_id = ? AND a.status = 'open' AND EXISTS (SELECT 1 FROM beam_sessions s WHERE s.course_id = a.course_id AND s.state = 'scheduled') ORDER BY a.due_at", actor.id)
  const options = await Promise.all(assigned.map(async assignment => ({
    assignment: assignment.id, course: assignment.course_id, courseTitle: assignment.courseTitle,
    blocked: await prerequisiteMet(env, assignment) ? null : { prerequisite: assignment.prerequisite_course_id, prerequisiteTitle: assignment.prerequisiteTitle },
    sessions: await shape(env, await all(env, `${SESSION} WHERE s.course_id = ? AND s.state = 'scheduled' AND ${FIRST} > ? ORDER BY ${FIRST}`, assignment.course_id, now())),
  })))
  const leading = await shape(env, await all(env, `${SESSION} WHERE s.instructor_id = ? ORDER BY s.start_date`, actor.id))
  const units = sessionUnits(actor)
  const managed = schedules(actor) ? await shape(env, await all(env, `${SESSION} WHERE ? OR c.unit_id IN (SELECT value FROM json_each(?)) ORDER BY s.state DESC, s.start_date`, actor.owner ? 1 : 0, JSON.stringify(units)), () => null, true) : []
  const courses = schedules(actor) ? await all(env, 'SELECT id, title FROM beam_courses WHERE published_revision_id IS NOT NULL AND retired_at IS NULL AND (? OR unit_id IN (SELECT value FROM json_each(?))) ORDER BY title', actor.owner ? 1 : 0, JSON.stringify(units)) : []
  const [waits, history] = await Promise.all([myWaits(env, actor), learnerEvents(env, actor)])
  return { agenda, waits, history: history.map(item => ({ ...item, detail: JSON.parse(item.detail) })), options: options.filter(option => option.sessions.length), leading, managed, courses }
}

/** A session's calendar file is for its registered (or formerly registered) learners, its instructor and its schedulers. */
export async function sessionForCalendar(env: Bindings, actor: Actor, id: string) {
  const [session] = await shape(env, await all(env, `${SESSION} WHERE s.id = ?`, id))
  insist(session, 'not_found', 404)
  const registration = await one(env, 'SELECT state FROM beam_session_registrations WHERE session_id = ? AND learner_id = ? ORDER BY registered_at DESC LIMIT 1', id, actor.id)
  if (!registration && session.instructor !== actor.id) {
    try { await requireScheduler(env, actor, session.course) } catch { insist(false, 'not_found', 404) }
  }
  return { session, cancelled: session.state === 'cancelled' || registration?.state === 'cancelled' }
}

/** Scheduled future session options per course, for the role paths page. */
export async function sessionOptionCounts(env: Bindings) {
  const rows = await all(env, `SELECT s.course_id AS course, COUNT(*) AS n FROM beam_sessions s WHERE s.state = 'scheduled' AND ${FIRST} > ? GROUP BY s.course_id`, now())
  return new Map(rows.map(row => [row.course as string, row.n as number]))
}
