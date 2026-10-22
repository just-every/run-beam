import { t, localeNumber } from './messages'
// REPORT-003, transcript slice: one person's readable learning transcript. Every assignment with its exact revision,
// every attempt (including those before a reset), assessor decision, completion and certificate (native or offline
// attendance), every live attendance decision and amendment, every amendment (due-date exception, access extension,
// reset, cancellation) and every imported history
// row with its provenance, in time order. Whoever may read the person's record reads it (records.ts).
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, now, type Row } from './core'
import { learnerRecord } from './records'
import { requireBusiness } from './people'
import { externalTranscript } from './external'

export interface TranscriptEntry { at: number; kind: string; course: string; revision: number | null; detail: string; lineage?: string; by: string; record: string }

const pick = (payload: Row, skip: string[]) => Object.entries(payload).filter(([key, value]) => !skip.includes(key) && value !== null && value !== '').map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join('; ')

export async function transcript(env: Bindings, actor: Actor, memberId: string) {
  const record = await learnerRecord(env, actor, memberId)
  const zone = (await requireBusiness(env)).timezone, asOf = now()
  const of = 'JOIN beam_assignments a ON a.id = x.assignment_id JOIN beam_courses c ON c.id = a.course_id JOIN beam_course_revisions r ON r.id = a.course_revision_id'
  const name = (column: string) => `(SELECT name FROM beam_members WHERE id = ${column})`
  const [assigned, attempts, decisions, completions, attendance, dues, extensions, resets, cancels, external] = await Promise.all([
    all(env, `SELECT a.id, a.assigned_at AS at, c.title, r.number, a.due_at AS dueAt, a.reason, ${name('a.assigned_by')} AS by FROM beam_assignments a JOIN beam_courses c ON c.id = a.course_id JOIN beam_course_revisions r ON r.id = a.course_revision_id WHERE a.learner_id = ?`, memberId),
    all(env, `SELECT x.id, x.submitted_at AS at, x.kind, x.number, x.score, x.max_score AS maxScore, x.passed, x.state, x.reset_id AS reset, x.close_reason AS closeReason, c.title, r.number AS revision FROM beam_attempts x ${of} WHERE a.learner_id = ?`, memberId),
    all(env, `SELECT d.id, d.decided_at AS at, d.decision, d.note, ${name('d.assessor_id')} AS by, c.title, r.number AS revision, t.number FROM beam_review_decisions d JOIN beam_attempts t ON t.id = d.attempt_id JOIN beam_assignments a ON a.id = t.assignment_id JOIN beam_courses c ON c.id = a.course_id JOIN beam_course_revisions r ON r.id = a.course_revision_id WHERE a.learner_id = ?`, memberId),
    all(env, `SELECT x.id, x.completed_at AS at, x.method, x.evidence_json AS evidence, x.expires_at AS expiresAt, k.number AS certificate, c.title, r.number AS revision FROM beam_completions x JOIN beam_courses c ON c.id = x.course_id JOIN beam_course_revisions r ON r.id = x.course_revision_id LEFT JOIN beam_certificates k ON k.completion_id = x.id WHERE x.learner_id = ?`, memberId),
    // Read attendance itself, including records which never produced a completion and all superseded decisions.
    // The assignment keeps the revision originally attested even if the learner subsequently moves revisions.
    all(env, `SELECT x.id, x.recorded_at AS at, x.session_id AS session, s.title AS sessionTitle, x.registration_id AS registration, x.assignment_id AS assignment,
      a.course_revision_id AS courseRevision, r.title, r.number AS revision, x.status, x.minutes, x.decision, x.note, x.attachment_id AS attachment,
      x.recorded_by AS recordedBy, ${name('x.recorded_by')} AS by, x.amends_id AS amends, x.amend_reason AS reason, x.superseded_at AS supersededAt,
      (SELECT next.id FROM beam_attendance next WHERE next.amends_id = x.id) AS supersededBy
      FROM beam_attendance x JOIN beam_sessions s ON s.id = x.session_id JOIN beam_assignments a ON a.id = x.assignment_id
      JOIN beam_course_revisions r ON r.id = a.course_revision_id WHERE x.learner_id = ? ORDER BY x.recorded_at, x.rowid`, memberId),
    all(env, `SELECT x.id, x.approved_at AS at, x.previous_due_at AS previous, x.due_at AS dueAt, x.reason, ${name('x.approved_by')} AS by, c.title, r.number AS revision FROM beam_due_exceptions x ${of} WHERE a.learner_id = ?`, memberId),
    all(env, `SELECT x.id, x.extended_at AS at, x.days, x.reason, ${name('x.extended_by')} AS by, c.title, r.number AS revision FROM beam_access_extensions x ${of} WHERE a.learner_id = ?`, memberId),
    all(env, `SELECT x.id, x.reset_at AS at, x.reason, x.kind, ${name('x.reset_by')} AS by, c.title, r.number AS revision FROM beam_assignment_resets x ${of} WHERE a.learner_id = ?`, memberId),
    all(env, `SELECT x.subject AS id, x.at, x.detail, ${name('x.actor')} AS by, c.title, r.number AS revision FROM beam_audit x JOIN beam_assignments a ON a.id = x.subject JOIN beam_courses c ON c.id = a.course_id JOIN beam_course_revisions r ON r.id = a.course_revision_id WHERE x.action = 'assignment.cancel' AND a.learner_id = ?`, memberId),
    externalTranscript(env, memberId),
  ])
  const day = (at: number) => actor.locale === 'es-US' ? new Intl.DateTimeFormat(actor.locale, { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(at) : new Date(at).toISOString()
  const tr = (key: string, values = {}) => t(actor, key, values)
  const entries: TranscriptEntry[] = [
    ...assigned.map(row => ({ at: row.at, kind: 'assigned', course: row.title, revision: row.number, detail: `${tr('due {date}', { date: day(row.dueAt) })}${row.reason ? `; ${row.reason}` : ''}`, by: row.by ?? '', record: row.id })),
    ...attempts.map(row => ({ at: row.at, kind: `${row.kind} attempt`, course: row.title, revision: row.revision, detail: `${tr('attempt {n}: {result}', { n: localeNumber(actor, row.number), result: row.kind === 'quiz' ? tr('{score} of {total}, {result}', { score: localeNumber(actor, row.score), total: localeNumber(actor, row.maxScore), result: tr(row.passed ? 'passed' : 'not passed') }) + (row.closeReason === 'expired' ? tr(', time ran out') : '') : tr(row.state.replace(/_/g, ' ')) })}${row.reset ? tr('; before a reset') : ''}`, by: '', record: row.id })),
    ...decisions.map(row => ({ at: row.at, kind: 'assessor decision', course: row.title, revision: row.revision, detail: tr('attempt {n} {decision}: {note}', { n: localeNumber(actor, row.number), decision: tr(row.decision), note: row.note }), by: row.by ?? '', record: row.id })),
    ...completions.map(row => ({ at: row.at, kind: row.method === 'offline' ? 'offline attendance completion' : 'completion', course: row.title, revision: row.revision, detail: `${row.certificate ? tr('certificate {number}', { number: row.certificate }) : tr('no certificate')}${row.expiresAt ? tr(', expires {date}', { date: day(row.expiresAt) }) : ''}${row.method === 'offline' ? `; ${pick(JSON.parse(row.evidence), ['attachment'])}` : ''}`, by: '', record: row.id })),
    ...attendance.map(row => ({ at: row.at, kind: 'live attendance', course: row.title, revision: row.revision,
      detail: `session ${row.sessionTitle}; ${row.status}; ${row.minutes} minutes; decision ${row.decision}${row.note ? `; note: ${row.note}` : ''}${row.amends ? `; amendment: ${row.reason}` : ''}${row.supersededAt !== null ? `; superseded at ${day(row.supersededAt)}` : '; current attendance record'}`,
      lineage: `attendance: ${row.id}; session: ${row.session}; registration: ${row.registration}; assignment: ${row.assignment}; course revision: ${row.courseRevision}; recorded by: ${row.recordedBy}${row.attachment ? `; attachment: ${row.attachment}` : ''}${row.amends ? `; amends: ${row.amends}` : ''}${row.supersededBy ? `; superseded by: ${row.supersededBy}` : ''}`,
      by: row.by ?? '', record: row.id })),
    ...dues.map(row => ({ at: row.at, kind: 'due date changed', course: row.title, revision: row.revision, detail: tr('from {from} to {to}: {reason}', { from: day(row.previous), to: day(row.dueAt), reason: row.reason }), by: row.by ?? '', record: row.id })),
    ...extensions.map(row => ({ at: row.at, kind: 'access extended', course: row.title, revision: row.revision, detail: tr('{n} days: {reason}', { n: localeNumber(actor, row.days), reason: row.reason }), by: row.by ?? '', record: row.id })),
    ...resets.map(row => ({ at: row.at, kind: row.kind === 'move' ? 'moved to a new revision' : 'progress reset', course: row.title, revision: row.revision, detail: row.reason, by: row.by ?? '', record: row.id })),
    ...cancels.map(row => ({ at: row.at, kind: 'assignment cancelled', course: row.title, revision: row.revision, detail: JSON.parse(row.detail).reason ?? '', by: row.by ?? '', record: row.id })),
    ...record.history.map((row: Row) => ({ at: Date.parse(`${row.completedOn}T00:00:00Z`) || 0, kind: 'imported history', course: row.sourceCourseName ?? '', revision: null, detail: `completed ${row.completedOn} in ${row.source}${row.accepted ? ', reviewed' : ''}; provenance ${pick(row, ['id', 'kind', 'member', 'sourceCourseName', 'completedOn', 'source', 'accepted'])}; never counts as a Beam completion`, by: '', record: row.id })),
    ...external,
  ].sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind))
  return { member: record.member, zone, asOf, filters: 'every record of this person; nothing left out', count: entries.length, entries }
}

/** Portable detail retains attendance identifiers alongside the readable decision. */
export const transcriptDetail = (entry: TranscriptEntry) => entry.lineage ? `${entry.detail}; ${entry.lineage}` : entry.detail
