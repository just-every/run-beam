// Flows 10-12: instructor-attested offline training, completion certificates,
// in-app reminders and the manager, reviewer and assessor queues.
import type { Bindings } from '../auth.server'
import { accessState } from './access'
import { isManager, requireRole, type Actor } from './actor'
import { renewalsDue } from './assignments'
import { BeamError, all, insist, newId, now, one, sha256Hex, stmt, type Row } from './core'
import { store } from './files'
import type { Input } from './input'
import { recordCompletion } from './learning'
import { requireBusiness } from './people'
import { recordStatus } from './report'
import { DAY, calendarDays, localDate, zonedInstant } from './time'
import { learnerInUnits } from './units'

export async function recordOffline(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'manager', 'assessor')
  const business = await requireBusiness(env)
  const course = await one(env, 'SELECT id, published_revision_id FROM beam_courses WHERE id = ?', input.text('course'))
  insist(course, 'course_not_found', 404)
  // The caller attests a particular immutable revision, including historical
  // published revisions. Never substitute whatever is current on submission.
  const revision = input.text('revision')
  insist(await one(env, "SELECT 1 FROM beam_course_revisions WHERE id = ? AND course_id = ? AND state IN ('published', 'superseded')", revision, course.id), 'revision_not_published_for_course', 409)
  const heldOn = input.text('heldOn')
  const completedAt = zonedInstant(heldOn, '12:00', business.timezone)
  insist(heldOn <= localDate(now(), business.timezone), 'held_in_future')
  const instructor = input.text('instructor', { max: 160 })
  const location = input.text('location', { max: 160 })
  const attestation = input.text('attestation', { max: 2000 })
  const learners = input.list('learners')
  insist(learners.length > 0, 'learners_required')
  for (const learner of learners) insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', learner), 'person_not_found', 404)
  insist(!learners.includes(actor.id), 'self_attestation_refused', 403)
  const file = await input.file('file', { optional: true })
  const attachment = file ? { id: newId(), ...await store(env, file) } : null
  // The form carries a one-time submission key, so a double click or a retried form records the attendance once.
  const submission = input.text('submission', { optional: true, max: 100 })
  const session = submission ? await sha256Hex(new TextEncoder().encode(`offline:${actor.id}:${submission}`)) : newId()
  const written = await env.DB.batch([
    ...(attachment ? [stmt(env, 'INSERT INTO beam_attachments (id, filename, media_type, size, sha256, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)', attachment.id, attachment.filename, attachment.mediaType, attachment.size, attachment.sha256, actor.id, now())] : []),
    stmt(env, 'INSERT INTO beam_offline_sessions (id, course_id, course_revision_id, held_on, instructor, location, attested_by, attestation, attachment_id, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING', session, course.id, revision, heldOn, instructor, location, actor.id, attestation, attachment?.id ?? null, now()),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', now(), actor.id, 'offline.record', session, JSON.stringify({ course: course.id, learners, instructor })),
  ])
  if (written[attachment ? 1 : 0].meta.changes === 0) return { session, completions: [], alreadyRecorded: true }
  const completions = []
  for (const learner of learners) {
    const open = await one(env, "SELECT id, renewal_days FROM beam_assignments WHERE learner_id = ? AND course_id = ? AND course_revision_id = ? AND status = 'open'", learner, course.id, revision)
    completions.push(await recordCompletion(env, actor, { assignment: open?.id ?? null, learner, course: course.id, revision, assessmentRevision: null, method: 'offline', evidence: { offlineSession: session, instructor, attestedBy: actor.id, attachment: attachment?.id ?? null }, renewalDays: open?.renewal_days ?? null, completedAt }))
  }
  return { session, completions }
}

export async function certificate(env: Bindings, actor: Actor, id: string) {
  const row = await one(env, `SELECT k.*, c.learner_id, c.method, c.completed_at, c.course_revision_id, r.number AS revision_number, r.title AS course_title, m.name AS learner_name
    FROM beam_certificates k JOIN beam_completions c ON c.id = k.completion_id JOIN beam_course_revisions r ON r.id = c.course_revision_id JOIN beam_members m ON m.id = c.learner_id WHERE k.id = ?`, id)
  if (!row || !(row.learner_id === actor.id || isManager(actor))) throw new BeamError('not_found', 404)
  return { id: row.id, number: row.number, issuer: row.issuer, learner: row.learner_name, course: row.course_title, revision: row.revision_number, method: row.method, completedAt: row.completed_at, issuedAt: row.issued_at, expiresAt: row.expires_at }
}

/** A learner's own record, any learner's for a manager, or one in their units for a learning administrator. */
export async function learnerRecord(env: Bindings, actor: Actor, memberId: string) {
  if (!(memberId === actor.id || isManager(actor) || await learnerInUnits(env, actor, memberId))) throw new BeamError('not_found', 404)
  const member = await one(env, 'SELECT id, name, email FROM beam_members WHERE id = ?', memberId)
  if (!member) throw new BeamError('not_found', 404)
  const assignments = await all(env, `SELECT a.id, a.course_id AS course, c.title AS courseTitle, r.number AS revisionNumber, a.status, a.due_date AS dueDate, a.due_time AS dueTime, a.timezone, a.due_at AS dueAt, a.reason, a.prerequisite_course_id AS prerequisite,
    (SELECT COUNT(*) FROM beam_lesson_progress p WHERE p.assignment_id = a.id) AS lessonsDone, (SELECT COUNT(*) FROM beam_lesson_revisions l WHERE l.course_revision_id = a.course_revision_id) AS lessonsTotal,
    k.id AS completion, k.expires_at AS expiresAt, a.access_opens_at AS accessOpensAt, a.access_closes_at AS accessClosesAt
    FROM beam_assignments a JOIN beam_courses c ON c.id = a.course_id JOIN beam_course_revisions r ON r.id = a.course_revision_id LEFT JOIN beam_completions k ON k.assignment_id = a.id WHERE a.learner_id = ? ORDER BY a.status = 'open' DESC, a.due_at`, memberId)
  // `state` is the record's one status, the same as Manage and the report show; `status` stays the stored assignment state.
  const at = now()
  const shaped = assignments.map(row => ({ ...row, access: accessState({ access_opens_at: row.accessOpensAt, access_closes_at: row.accessClosesAt }, at), state: recordStatus({ ...row, assignmentStatus: row.status } as any, at), daysOverdue: row.status === 'open' && row.dueAt < at ? calendarDays(row.dueAt, at, row.timezone) : null }) as Row)
  const completions = await all(env, `SELECT c.id, c.course_id AS course, r.title AS courseTitle, r.number AS revisionNumber, c.course_revision_id AS revision, c.assessment_revision_id AS assessmentRevision, c.method, c.evidence_json AS evidence, c.completed_at AS completedAt, c.expires_at AS expiresAt, k.id AS certificate
    FROM beam_completions c JOIN beam_course_revisions r ON r.id = c.course_revision_id LEFT JOIN beam_certificates k ON k.completion_id = c.id WHERE c.learner_id = ? ORDER BY c.completed_at DESC`, memberId)
  const history = (await all(env, "SELECT id, payload FROM beam_imported_history WHERE kind = 'completion'")).map(row => ({ id: row.id, ...JSON.parse(row.payload) })).filter(row => row.member === memberId)
  return { member, assignments: shaped, completions: completions.map(row => ({ ...row, evidence: JSON.parse(row.evidence) }) as Row), history }
}

export async function reminders(env: Bindings, actor: Actor) {
  const soon = now() + 3 * DAY
  return await all(env, `SELECT a.id, c.title AS courseTitle, a.due_at AS dueAt, a.due_date AS dueDate, a.due_time AS dueTime, a.timezone, CASE WHEN a.due_at < ? THEN 'overdue' ELSE 'due_soon' END AS kind
    FROM beam_assignments a JOIN beam_courses c ON c.id = a.course_id WHERE a.learner_id = ? AND a.status = 'open' AND a.due_at <= ? ORDER BY a.due_at`, now(), actor.id, soon)
}

export async function queues(env: Bindings, actor: Actor) {
  const manager = isManager(actor)
  return {
    overdue: manager ? await all(env, `SELECT a.id, a.learner_id AS learner, m.name AS learnerName, c.title AS courseTitle, a.due_at AS dueAt, a.timezone FROM beam_assignments a JOIN beam_members m ON m.id = a.learner_id JOIN beam_courses c ON c.id = a.course_id
      WHERE a.status = 'open' AND a.due_at < ? ORDER BY a.due_at`, now()) : [],
    attemptsExhausted: manager ? await all(env, `SELECT a.id, m.name AS learnerName, c.title AS courseTitle FROM beam_assignments a JOIN beam_members m ON m.id = a.learner_id JOIN beam_courses c ON c.id = a.course_id JOIN beam_assessment_revisions s ON s.course_revision_id = a.course_revision_id
      WHERE a.status = 'open' AND s.max_attempts IS NOT NULL AND (SELECT COUNT(*) FROM beam_attempts t WHERE t.assignment_id = a.id AND t.kind = 'quiz' AND t.reset_id IS NULL) >= s.max_attempts + a.extra_attempts
      AND NOT EXISTS (SELECT 1 FROM beam_attempts t WHERE t.assignment_id = a.id AND t.kind = 'quiz' AND t.passed = 1 AND t.reset_id IS NULL)`) : [],
    renewals: manager ? await renewalsDue(env) : [],
    reviews: actor.roles.has('reviewer') ? await all(env, `SELECT r.id, r.course_id AS course, r.number, r.title, r.submitted_at AS submittedAt FROM beam_course_revisions r JOIN beam_courses c ON c.id = r.course_id
      WHERE r.state = 'in_review' AND (c.reviewer_id = ? OR ?) ORDER BY r.submitted_at`, actor.id, actor.owner ? 1 : 0) : [],
    notices: actor.roles.has('reviewer') ? await all(env, `SELECT n.id, n.course_id AS course, c.title AS courseTitle, s.title AS sourceTitle FROM beam_source_notices n JOIN beam_courses c ON c.id = n.course_id JOIN beam_sources s ON s.id = n.source_id
      WHERE n.state = 'open' AND (c.reviewer_id = ? OR ?) ORDER BY n.created_at`, actor.id, actor.owner ? 1 : 0) : [],
    assessments: actor.roles.has('assessor') ? await all(env, `SELECT t.id, m.name AS learnerName, c.title AS courseTitle, t.submitted_at AS submittedAt FROM beam_attempts t JOIN beam_assessment_revisions s ON s.id = t.assessment_revision_id JOIN beam_assignments a ON a.id = t.assignment_id
      JOIN beam_members m ON m.id = a.learner_id JOIN beam_courses c ON c.id = a.course_id WHERE t.state = 'awaiting_review' AND t.reset_id IS NULL AND s.assessor_id = ? ORDER BY t.submitted_at`, actor.id) : [],
  }
}
