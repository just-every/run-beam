// LIVE-001 and LIVE-002: choosing a session, its seats and its waitlist. A learner with an open assignment of the course
// chooses a session once the assignment's prerequisite is complete and before the session's registration deadline; one
// session per course, and switching keeps the earlier registration as cancelled. A session with a capacity holds that
// many seats: registered learners plus open seat offers. When it is full the learner joins its waitlist instead (keeping
// any other session of the course they hold). When a seat opens, the session's policy either offers it to the next
// waiting learner for a set number of hours or assigns it straight away; next is the earliest to join, or under the
// due-date order the one whose assignment is due soonest. Every seat is taken inside one D1 transaction that counts the
// seats first, so simultaneous bookings, offers and switches never oversell. Expired offers are swept whenever the
// sessions are read or written. Nothing is deleted: waitlist entries keep their end state and every step is a roster
// event.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { prerequisiteMet } from './learning'
import { zonedInstant } from './time'

export const FIRST = '(SELECT MIN(starts_at) FROM beam_session_meetings m WHERE m.session_id = s.id)'
export const POLICIES = ['offer', 'assign'] as const
export const ORDERS = ['joined', 'due'] as const
/** True while the session bound as ?1 has a free seat (no capacity means unlimited). */
const SEAT_FREE = `(SELECT s.capacity IS NULL OR s.capacity > (SELECT COUNT(*) FROM beam_session_registrations r WHERE r.session_id = s.id AND r.state = 'registered')
  + (SELECT COUNT(*) FROM beam_session_waitlist w WHERE w.session_id = s.id AND w.state = 'offered') FROM beam_sessions s WHERE s.id = ?1)`

const event = (env: Bindings, session: string, learner: string, kind: string, detail: unknown = {}, when = '1') =>
  stmt(env, `INSERT INTO beam_session_events (id, session_id, learner_id, at, kind, detail) SELECT ?, ?, ?, ?, ?, ? WHERE ${when}`, newId(), session, learner, now(), kind, JSON.stringify(detail))

/** Seat settings: capacity (blank for unlimited), an optional registration deadline in the session's zone that is not
 * after its first meeting, what happens when a seat opens, how long an offer lasts and the waitlist order. */
export function readSeats(input: Input, timezone: string, firstStart: number) {
  const capacity = input.integer('capacity', { min: 1, max: 1000, optional: true })
  const closesDate = input.text('closesDate', { optional: true, max: 10 })
  const closesAt = closesDate ? zonedInstant(closesDate, input.text('closesTime', { optional: true, max: 5 }) || '23:59', timezone) : null
  insist(closesAt === null || closesAt <= firstStart, 'deadline_after_start')
  const policy = input.text('policy', { optional: true }) || 'offer'
  insist((POLICIES as readonly string[]).includes(policy), 'invalid_policy')
  const order = input.text('order', { optional: true }) || 'joined'
  insist((ORDERS as readonly string[]).includes(order), 'invalid_order')
  return { capacity, closesAt, policy, order, offerHours: input.integer('offerHours', { min: 1, max: 168, optional: true }) ?? 24 }
}

const loadSession = (env: Bindings, id: string) => one(env, `SELECT s.*, ${FIRST} AS first FROM beam_sessions s WHERE s.id = ?`, id)

/** Ends offers whose time has passed and passes their seats on. */
export async function sweep(env: Bindings, session?: string) {
  const at = now()
  const expired = await all(env, `SELECT id, session_id, learner_id FROM beam_session_waitlist WHERE state = 'offered' AND offer_expires_at <= ? AND (? IS NULL OR session_id = ?)`, at, session ?? null, session ?? null)
  if (!expired.length) return
  await env.DB.batch(expired.flatMap(row => [
    stmt(env, "UPDATE beam_session_waitlist SET state = 'expired', ended_at = ? WHERE id = ? AND state = 'offered'", at, row.id),
    event(env, row.session_id, row.learner_id, 'offer_expired'),
  ]))
  for (const id of new Set(expired.map(row => row.session_id as string))) await promote(env, id)
}

/** Fills free seats from the waitlist under the session's policy, until the seats or the waitlist run out. */
export async function promote(env: Bindings, id: string, depth = 0): Promise<void> {
  for (let round = 0; round < 1000; round++) {
    const session = await loadSession(env, id)
    if (!session || session.state !== 'scheduled' || session.first <= now() || session.capacity === null) return
    const next = await one(env, `SELECT w.*, a.status AS assignmentStatus FROM beam_session_waitlist w JOIN beam_assignments a ON a.id = w.assignment_id
      WHERE w.session_id = ? AND w.state = 'waiting' ORDER BY CASE WHEN ? = 'due' THEN a.due_at ELSE 0 END, w.joined_at, w.id LIMIT 1`, id, session.waitlist_order)
    if (!next || !(await one<{ free: number }>(env, `SELECT ${SEAT_FREE} AS free`, id))?.free) return
    const at = now()
    if (next.assignmentStatus !== 'open') {
      await env.DB.batch([stmt(env, "UPDATE beam_session_waitlist SET state = 'closed', ended_at = ? WHERE id = ?", at, next.id), event(env, id, next.learner_id, 'closed', { reason: 'assignment no longer open' })])
      continue
    }
    if (session.waitlist_policy === 'offer') {
      const expires = at + session.offer_hours * 3_600_000
      await env.DB.batch([
        stmt(env, `UPDATE beam_session_waitlist SET state = 'offered', offered_at = ?2, offer_expires_at = ?3 WHERE id = ?4 AND state = 'waiting' AND ${SEAT_FREE}`, id, at, expires, next.id),
        event(env, id, next.learner_id, 'offered', { expiresAt: expires }, `EXISTS (SELECT 1 FROM beam_session_waitlist WHERE id = '${next.id}' AND state = 'offered')`),
      ])
      continue
    }
    const moved = await take(env, session, next.learner_id, next.assignment_id, { wait: next.id, state: 'assigned', kind: 'assigned' })
    if (!moved.registered) return
    if (moved.switchedFrom && depth < 3) await promote(env, moved.switchedFrom, depth + 1)
  }
}

/** Takes a seat for the learner in one transaction: their registration in another session of the course ends as switched
 * only if the seat is taken. `held` seats (an accepted offer) are already counted, so they skip the seat check. */
async function take(env: Bindings, session: Row, learner: string, assignment: string, { wait = null, state = null, kind = 'registered', held = false }: { wait?: string | null; state?: string | null; kind?: string; held?: boolean } = {}) {
  const current = await one(env, "SELECT id, session_id FROM beam_session_registrations WHERE course_id = ? AND learner_id = ? AND state = 'registered'", session.course_id, learner)
  const id = newId(), at = now(), seat = held ? `EXISTS (SELECT 1 FROM beam_session_waitlist WHERE id = ?2 AND state = 'offered')` : SEAT_FREE
  const created = `EXISTS (SELECT 1 FROM beam_session_registrations WHERE id = '${id}')`
  await env.DB.batch([
    ...(current ? [stmt(env, `UPDATE beam_session_registrations SET state = 'cancelled', ended_at = ?3, end_reason = 'switched' WHERE id = ?4 AND state = 'registered' AND ${seat}`, session.id, wait, at, current.id)] : []),
    stmt(env, `INSERT INTO beam_session_registrations (id, session_id, course_id, learner_id, assignment_id, state, registered_at) SELECT ?3, ?1, ?4, ?5, ?6, 'registered', ?7 WHERE ${seat}`, session.id, wait, id, session.course_id, learner, assignment, at),
    ...(wait ? [stmt(env, `UPDATE beam_session_waitlist SET state = ?, ended_at = ? WHERE id = ? AND ${created}`, state, at, wait)] : []),
    event(env, session.id, learner, kind, current ? { switchedFrom: current.session_id } : {}, created),
    ...(current ? [event(env, current.session_id, learner, 'switched', { to: session.id }, created)] : []),
  ])
  const registered = !!await one(env, 'SELECT 1 FROM beam_session_registrations WHERE id = ?', id)
  return { registered, registration: registered ? id : null, switchedFrom: registered && current ? current.session_id as string : null }
}

/** The learner chooses a session: a seat when one is free, otherwise a place on its waitlist. */
export async function register(env: Bindings, actor: Actor, input: Input) {
  const sessionId = input.text('session')
  await sweep(env, sessionId)
  const session = await loadSession(env, sessionId)
  insist(session, 'session_not_found', 404)
  const assignment = await one(env, "SELECT * FROM beam_assignments WHERE learner_id = ? AND course_id = ? AND status = 'open'", actor.id, session.course_id)
  insist(assignment, 'session_not_offered', 404)
  insist(session.state === 'scheduled', 'session_cancelled', 409)
  insist(session.first > now(), 'session_started', 409)
  insist(session.registration_closes_at === null || now() < session.registration_closes_at, 'registration_closed', 409)
  insist(await prerequisiteMet(env, assignment), 'prerequisite_incomplete', 409)
  insist(!await one(env, "SELECT 1 FROM beam_session_registrations WHERE session_id = ? AND learner_id = ? AND state = 'registered'", session.id, actor.id), 'already_registered', 409)
  insist(!await one(env, "SELECT 1 FROM beam_session_waitlist WHERE session_id = ? AND learner_id = ? AND state IN ('waiting', 'offered')", session.id, actor.id), 'already_waitlisted', 409)
  const taken = await take(env, session, actor.id, assignment.id)
  if (taken.registered) {
    await commit(env, [], { actor, action: 'session.register', subject: session.id, detail: { registration: taken.registration, switchedFrom: taken.switchedFrom } })
    if (taken.switchedFrom) await promote(env, taken.switchedFrom)
    return { id: session.id, outcome: 'registered', registration: taken.registration }
  }
  const wait = newId()
  await commit(env, [
    stmt(env, "INSERT INTO beam_session_waitlist (id, session_id, course_id, learner_id, assignment_id, state, joined_at) VALUES (?, ?, ?, ?, ?, 'waiting', ?)", wait, session.id, session.course_id, actor.id, assignment.id, now()),
    event(env, session.id, actor.id, 'waitlisted'),
  ], { actor, action: 'session.waitlist', subject: session.id, detail: { waitlist: wait } })
  await promote(env, session.id)
  return { id: session.id, outcome: 'waitlisted', waitlist: wait }
}

/** Accepting an offer turns the held seat into a registration. */
export async function acceptOffer(env: Bindings, actor: Actor, input: Input) {
  const sessionId = input.text('session')
  await sweep(env, sessionId)
  const offer = await one(env, "SELECT * FROM beam_session_waitlist WHERE session_id = ? AND learner_id = ? AND state = 'offered'", sessionId, actor.id)
  insist(offer, 'no_open_offer', 409)
  const session = (await loadSession(env, sessionId))!
  insist(session.state === 'scheduled', 'session_cancelled', 409)
  insist(session.first > now(), 'session_started', 409)
  const taken = await take(env, session, actor.id, offer.assignment_id, { wait: offer.id, state: 'accepted', kind: 'accepted', held: true })
  insist(taken.registered, 'no_open_offer', 409)
  await commit(env, [], { actor, action: 'session.accept', subject: session.id, detail: { registration: taken.registration, switchedFrom: taken.switchedFrom } })
  if (taken.switchedFrom) await promote(env, taken.switchedFrom)
  return { id: session.id, registration: taken.registration }
}

/** Leaving gives up a seat, declines an offer or leaves the waitlist; a freed seat passes on at once. */
export async function leave(env: Bindings, actor: Actor, input: Input) {
  const session = input.text('session'), at = now()
  await sweep(env, session)
  const registration = await one(env, "SELECT id FROM beam_session_registrations WHERE session_id = ? AND learner_id = ? AND state = 'registered'", session, actor.id)
  const wait = registration ? null : await one(env, "SELECT id, state FROM beam_session_waitlist WHERE session_id = ? AND learner_id = ? AND state IN ('waiting', 'offered')", session, actor.id)
  insist(registration || wait, 'not_registered', 404)
  const kind = registration ? 'left' : wait!.state === 'offered' ? 'declined' : 'withdrawn'
  await commit(env, [
    registration ? stmt(env, "UPDATE beam_session_registrations SET state = 'cancelled', ended_at = ?, end_reason = 'left' WHERE id = ?", at, registration.id)
      : stmt(env, 'UPDATE beam_session_waitlist SET state = ?, ended_at = ? WHERE id = ?', kind, at, wait!.id),
    event(env, session, actor.id, kind),
  ], { actor, action: `session.${kind === 'left' ? 'leave' : kind === 'declined' ? 'decline' : 'unwaitlist'}`, subject: session, detail: {} })
  await promote(env, session)
  return { id: session }
}

/** This person's waitlist places and offers, with their place in the queue. */
export async function myWaits(env: Bindings, actor: Actor) {
  await sweep(env)
  const rows = await all(env, `SELECT w.id, w.session_id AS session, w.state, w.joined_at AS joinedAt, w.offer_expires_at AS offerExpiresAt, s.title, c.title AS courseTitle, s.timezone, s.waitlist_order AS waitlistOrder, a.due_at AS dueAt
    FROM beam_session_waitlist w JOIN beam_sessions s ON s.id = w.session_id JOIN beam_courses c ON c.id = s.course_id JOIN beam_assignments a ON a.id = w.assignment_id WHERE w.learner_id = ? AND w.state IN ('waiting', 'offered')`, actor.id)
  return await Promise.all(rows.map(async row => {
    const ahead = row.state === 'offered' ? null : await one<{ n: number }>(env, `SELECT COUNT(*) AS n FROM beam_session_waitlist w JOIN beam_assignments a ON a.id = w.assignment_id WHERE w.session_id = ? AND w.state = 'waiting'
      AND (CASE WHEN ? = 'due' THEN a.due_at ELSE 0 END < ? OR (CASE WHEN ? = 'due' THEN a.due_at ELSE 0 END = ? AND (w.joined_at < ? OR (w.joined_at = ? AND w.id < ?))))`,
      row.session, row.waitlistOrder, row.waitlistOrder === 'due' ? row.dueAt : 0, row.waitlistOrder, row.waitlistOrder === 'due' ? row.dueAt : 0, row.joinedAt, row.joinedAt, row.id)
    return { ...row, position: ahead ? ahead.n + 1 : null } as Row
  }))
}

/** Roster events: one learner's own, or a whole session's with names for whoever schedules it. */
export const learnerEvents = (env: Bindings, actor: Actor) => all(env, 'SELECT e.session_id AS session, s.title, e.kind, e.at, e.detail FROM beam_session_events e JOIN beam_sessions s ON s.id = e.session_id WHERE e.learner_id = ? ORDER BY e.at, e.rowid', actor.id)
export const sessionEvents = (env: Bindings, session: string) => all(env, 'SELECT e.learner_id AS learner, m.name AS learnerName, e.kind, e.at, e.detail FROM beam_session_events e JOIN beam_members m ON m.id = e.learner_id WHERE e.session_id = ? ORDER BY e.at, e.rowid', session)
