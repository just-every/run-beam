// LIVE-003: attendance on a session's roster. The session's named instructor or whoever schedules it records, for each
// registered learner once the session has begun: attended (all scheduled minutes), partial (the minutes attended) or
// absent, a completion decision, a note and optional evidence. Nobody records their own attendance. A record is never
// edited: an amendment needs a reason and supersedes the last record, so the timeline keeps every decision. Attendance
// completes only the exact revision of the learner's assignment, and only when that reviewed revision requires
// attendance and its online parts are also done (learning.ts); a course without the requirement is never completed by
// attendance, and other courses of a blended path stay outstanding.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import { store } from './files'
import type { Input } from './input'
import { attendanceState, tryComplete } from './learning'
import { requireScheduler } from './live'

export const STATUSES = ['attended', 'partial', 'absent'] as const

async function rosterSession(env: Bindings, actor: Actor, id: string) {
  const session = await one(env, 'SELECT s.*, c.title AS courseTitle, s.minutes * s.meetings AS scheduled, (SELECT MIN(starts_at) FROM beam_session_meetings m WHERE m.session_id = s.id) AS first FROM beam_sessions s JOIN beam_courses c ON c.id = s.course_id WHERE s.id = ?', id)
  insist(session, 'not_found', 404)
  if (session.instructor_id !== actor.id) {
    try { await requireScheduler(env, actor, session.course_id) } catch { insist(false, 'not_found', 404) }
  }
  return session
}

/** Whether this person keeps the session's roster (its instructor or a scheduler); used for evidence downloads. */
export async function keepsRoster(env: Bindings, actor: Actor, id: string) {
  return await rosterSession(env, actor, id).then(() => true, () => false)
}

async function readRecord(env: Bindings, input: Input, session: Row) {
  const status = input.text('status')
  insist((STATUSES as readonly string[]).includes(status), 'invalid_status')
  const minutes = status === 'attended' ? session.scheduled : status === 'absent' ? 0 : input.integer('minutes', { min: 1, max: session.scheduled - 1 })!
  const decision = status === 'absent' ? 'incomplete' : input.text('decision')
  insist(decision === 'complete' || decision === 'incomplete', 'invalid_decision')
  const file = await input.file('file', { optional: true })
  return { status, minutes, decision, note: input.text('note', { optional: true, max: 1000 }), attachment: file ? { id: newId(), ...await store(env, file) } : null }
}

async function write(env: Bindings, actor: Actor, session: Row, registration: Row, record: Awaited<ReturnType<typeof readRecord>>, amends: Row | null, reason: string | null) {
  const id = newId(), at = now(), attachment = record.attachment
  await commit(env, [
    ...(attachment ? [stmt(env, 'INSERT INTO beam_attachments (id, filename, media_type, size, sha256, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)', attachment.id, attachment.filename, attachment.mediaType, attachment.size, attachment.sha256, actor.id, at)] : []),
    ...(amends ? [stmt(env, 'UPDATE beam_attendance SET superseded_at = ? WHERE id = ? AND superseded_at IS NULL', at, amends.id)] : []),
    stmt(env, 'INSERT INTO beam_attendance (id, session_id, registration_id, learner_id, assignment_id, status, minutes, decision, note, attachment_id, recorded_by, recorded_at, amends_id, amend_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, session.id, registration.id, registration.learner_id, registration.assignment_id, record.status, record.minutes, record.decision, record.note, attachment?.id ?? null, actor.id, at, amends?.id ?? null, reason),
  ], { actor, action: amends ? 'attendance.amend' : 'attendance.record', subject: id, detail: { session: session.id, learner: registration.learner_id, status: record.status, minutes: record.minutes, decision: record.decision, amends: amends?.id ?? null, reason } })
  const completion = await tryComplete(env, actor, registration.assignment_id)
  return { id, completion: completion?.id ?? null }
}

export async function recordAttendance(env: Bindings, actor: Actor, input: Input) {
  const session = await rosterSession(env, actor, input.text('session'))
  insist(session.first <= now(), 'session_not_started', 409)
  const learner = input.text('learner')
  insist(learner !== actor.id, 'self_attestation_refused', 403)
  const registration = await one(env, "SELECT * FROM beam_session_registrations WHERE session_id = ? AND learner_id = ? AND state = 'registered'", session.id, learner)
  insist(registration, 'not_on_roster', 404)
  insist(!await one(env, 'SELECT 1 FROM beam_attendance WHERE session_id = ? AND learner_id = ? AND superseded_at IS NULL', session.id, learner), 'attendance_recorded', 409)
  return await write(env, actor, session, registration, await readRecord(env, input, session), null, null)
}

/** Corrects the current record: a new record with the reason supersedes it. A completion already recorded stays. */
export async function amendAttendance(env: Bindings, actor: Actor, input: Input) {
  const current = await one(env, 'SELECT * FROM beam_attendance WHERE id = ? AND superseded_at IS NULL', input.text('attendance'))
  insist(current, 'attendance_not_current', 409)
  const session = await rosterSession(env, actor, current.session_id)
  insist(current.learner_id !== actor.id, 'self_attestation_refused', 403)
  const reason = input.text('reason', { max: 500 })
  const registration = (await one(env, 'SELECT * FROM beam_session_registrations WHERE id = ?', current.registration_id))!
  return await write(env, actor, session, registration, await readRecord(env, input, session), current, reason)
}

/** The roster: each registered learner with their current record, every earlier record, and what their assignment still
 * needs (lessons, assessment, attendance) or its completion. */
export async function roster(env: Bindings, actor: Actor, id: string) {
  const session = await rosterSession(env, actor, id)
  const people = await all(env, `SELECT r.id AS registration, r.learner_id AS learner, m.name AS learnerName, r.assignment_id AS assignment, a.status AS assignmentStatus, cr.number AS revisionNumber, cr.attendance_percent AS attendancePercent,
      (SELECT COUNT(*) FROM beam_lesson_progress p WHERE p.assignment_id = a.id) AS lessonsDone, (SELECT COUNT(*) FROM beam_lesson_revisions l WHERE l.course_revision_id = a.course_revision_id) AS lessonsTotal,
      (SELECT k.id FROM beam_completions k WHERE k.assignment_id = a.id) AS completion
    FROM beam_session_registrations r JOIN beam_members m ON m.id = r.learner_id JOIN beam_assignments a ON a.id = r.assignment_id JOIN beam_course_revisions cr ON cr.id = a.course_revision_id
    WHERE r.session_id = ? AND r.state = 'registered' ORDER BY m.name`, id)
  const timeline = await all(env, `SELECT t.id, t.learner_id AS learner, t.status, t.minutes, t.decision, t.note, t.attachment_id AS attachment, t.recorded_at AS recordedAt, b.name AS recordedByName, t.amends_id AS amends, t.amend_reason AS reason, t.superseded_at AS supersededAt
    FROM beam_attendance t JOIN beam_members b ON b.id = t.recorded_by WHERE t.session_id = ? ORDER BY t.recorded_at, t.rowid`, id)
  const learners = await Promise.all(people.map(async person => ({ ...person, attendance: await attendanceState(env, person.assignment, person.attendancePercent),
    current: timeline.find(item => item.learner === person.learner && item.supersededAt === null) ?? null, timeline: timeline.filter(item => item.learner === person.learner) }) as Row))
  return { session: { id: session.id, title: session.title, courseTitle: session.courseTitle, scheduled: session.scheduled, started: session.first <= now(), timezone: session.timezone, first: session.first }, learners }
}

/** A learner's own attendance records, for their agenda. */
export const myAttendance = (env: Bindings, actor: Actor) => all(env, 'SELECT session_id AS session, status, minutes, decision, recorded_at AS recordedAt, amends_id AS amends FROM beam_attendance WHERE learner_id = ? AND superseded_at IS NULL', actor.id)
