// REPORT-003, transcript slice: one person's readable learning transcript. Every assignment with its exact revision,
// every attempt (including those before a reset), assessor decision, completion and certificate (native or offline
// attendance), every amendment (due-date exception, access extension, reset, cancellation) and every imported history
// row with its provenance, in time order. Whoever may read the person's record reads it (records.ts).
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, now, type Row } from './core'
import { learnerRecord } from './records'
import { requireBusiness } from './people'

export interface TranscriptEntry { at: number; kind: string; course: string; revision: number | null; detail: string; by: string; record: string }

const pick = (payload: Row, skip: string[]) => Object.entries(payload).filter(([key, value]) => !skip.includes(key) && value !== null && value !== '').map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join('; ')

export async function transcript(env: Bindings, actor: Actor, memberId: string) {
  const record = await learnerRecord(env, actor, memberId)
  const zone = (await requireBusiness(env)).timezone, asOf = now()
  const of = 'JOIN beam_assignments a ON a.id = x.assignment_id JOIN beam_courses c ON c.id = a.course_id JOIN beam_course_revisions r ON r.id = a.course_revision_id'
  const name = (column: string) => `(SELECT name FROM beam_members WHERE id = ${column})`
  const [assigned, attempts, decisions, completions, dues, extensions, resets, cancels] = await Promise.all([
    all(env, `SELECT a.id, a.assigned_at AS at, c.title, r.number, a.due_at AS dueAt, a.reason, ${name('a.assigned_by')} AS by FROM beam_assignments a JOIN beam_courses c ON c.id = a.course_id JOIN beam_course_revisions r ON r.id = a.course_revision_id WHERE a.learner_id = ?`, memberId),
    all(env, `SELECT x.id, x.submitted_at AS at, x.kind, x.number, x.score, x.max_score AS maxScore, x.passed, x.state, x.reset_id AS reset, x.close_reason AS closeReason, c.title, r.number AS revision FROM beam_attempts x ${of} WHERE a.learner_id = ?`, memberId),
    all(env, `SELECT d.id, d.decided_at AS at, d.decision, d.note, ${name('d.assessor_id')} AS by, c.title, r.number AS revision, t.number FROM beam_review_decisions d JOIN beam_attempts t ON t.id = d.attempt_id JOIN beam_assignments a ON a.id = t.assignment_id JOIN beam_courses c ON c.id = a.course_id JOIN beam_course_revisions r ON r.id = a.course_revision_id WHERE a.learner_id = ?`, memberId),
    all(env, `SELECT x.id, x.completed_at AS at, x.method, x.evidence_json AS evidence, x.expires_at AS expiresAt, k.number AS certificate, c.title, r.number AS revision FROM beam_completions x JOIN beam_courses c ON c.id = x.course_id JOIN beam_course_revisions r ON r.id = x.course_revision_id LEFT JOIN beam_certificates k ON k.completion_id = x.id WHERE x.learner_id = ?`, memberId),
    all(env, `SELECT x.id, x.approved_at AS at, x.previous_due_at AS previous, x.due_at AS dueAt, x.reason, ${name('x.approved_by')} AS by, c.title, r.number AS revision FROM beam_due_exceptions x ${of} WHERE a.learner_id = ?`, memberId),
    all(env, `SELECT x.id, x.extended_at AS at, x.days, x.reason, ${name('x.extended_by')} AS by, c.title, r.number AS revision FROM beam_access_extensions x ${of} WHERE a.learner_id = ?`, memberId),
    all(env, `SELECT x.id, x.reset_at AS at, x.reason, ${name('x.reset_by')} AS by, c.title, r.number AS revision FROM beam_assignment_resets x ${of} WHERE a.learner_id = ?`, memberId),
    all(env, `SELECT x.subject AS id, x.at, x.detail, ${name('x.actor')} AS by, c.title, r.number AS revision FROM beam_audit x JOIN beam_assignments a ON a.id = x.subject JOIN beam_courses c ON c.id = a.course_id JOIN beam_course_revisions r ON r.id = a.course_revision_id WHERE x.action = 'assignment.cancel' AND a.learner_id = ?`, memberId),
  ])
  const day = (at: number) => new Date(at).toISOString()
  const entries: TranscriptEntry[] = [
    ...assigned.map(row => ({ at: row.at, kind: 'assigned', course: row.title, revision: row.number, detail: `due ${day(row.dueAt)}${row.reason ? `; ${row.reason}` : ''}`, by: row.by ?? '', record: row.id })),
    ...attempts.map(row => ({ at: row.at, kind: `${row.kind} attempt`, course: row.title, revision: row.revision, detail: `attempt ${row.number}: ${row.kind === 'quiz' ? `${row.score} of ${row.maxScore}, ${row.passed ? 'passed' : 'not passed'}${row.closeReason === 'expired' ? ', time ran out' : ''}` : row.state.replace(/_/g, ' ')}${row.reset ? '; before a reset' : ''}`, by: '', record: row.id })),
    ...decisions.map(row => ({ at: row.at, kind: 'assessor decision', course: row.title, revision: row.revision, detail: `attempt ${row.number} ${row.decision}: ${row.note}`, by: row.by ?? '', record: row.id })),
    ...completions.map(row => ({ at: row.at, kind: row.method === 'offline' ? 'offline attendance completion' : 'completion', course: row.title, revision: row.revision, detail: `${row.certificate ? `certificate ${row.certificate}` : 'no certificate'}${row.expiresAt ? `, expires ${day(row.expiresAt)}` : ''}${row.method === 'offline' ? `; ${pick(JSON.parse(row.evidence), ['attachment'])}` : ''}`, by: '', record: row.id })),
    ...dues.map(row => ({ at: row.at, kind: 'due date changed', course: row.title, revision: row.revision, detail: `from ${day(row.previous)} to ${day(row.dueAt)}: ${row.reason}`, by: row.by ?? '', record: row.id })),
    ...extensions.map(row => ({ at: row.at, kind: 'access extended', course: row.title, revision: row.revision, detail: `${row.days} days: ${row.reason}`, by: row.by ?? '', record: row.id })),
    ...resets.map(row => ({ at: row.at, kind: 'progress reset', course: row.title, revision: row.revision, detail: row.reason, by: row.by ?? '', record: row.id })),
    ...cancels.map(row => ({ at: row.at, kind: 'assignment cancelled', course: row.title, revision: row.revision, detail: JSON.parse(row.detail).reason ?? '', by: row.by ?? '', record: row.id })),
    ...record.history.map((row: Row) => ({ at: Date.parse(`${row.completedOn}T00:00:00Z`) || 0, kind: 'imported history', course: row.sourceCourseName ?? '', revision: null, detail: `completed ${row.completedOn} in ${row.source}${row.accepted ? ', reviewed' : ''}; provenance ${pick(row, ['id', 'kind', 'member', 'sourceCourseName', 'completedOn', 'source', 'accepted'])}; never counts as a Beam completion`, by: '', record: row.id })),
  ].sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind))
  return { member: record.member, zone, asOf, filters: 'every record of this person; nothing left out', count: entries.length, entries }
}
