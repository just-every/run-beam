import { ltiRequirements } from './lti-requirements'
// Flows 6-9: learners resume lessons, take deterministic quizzes and submit
// practical evidence; completion is recorded only when every requirement of the
// exact assigned revision is met, and is bound to that revision.
import { completionNotifications } from './notification-delivery'
import { ATTEMPT_CHAIN, MOVE_CHAIN, countingAssignment, movesOf } from './moves'
import { attendanceRecords, keepsRoster } from './attendance'
import type { Bindings } from '../auth.server'
import { accessView, requireAccess } from './access'
import { isManager, requireRole, type Actor } from './actor'
import { revisionDetail, type Question } from './courses'
import { SCORING_RULE, drawQuestions, presentQuestion, weightOf, type Answer } from './question-types'
import { BeamError, all, commit, insist, newId, now, one, stmt, type Row } from './core'
import { serve, store } from './files'
import type { Input } from './input'
import { requireBusiness } from './people'
import { resetHistory } from './resets'
import { AWAITING_GRADING, type Accommodation, accommodationFor, closeSession, deadlineFor, extraMinutes, openSession, refuseLate, responseRows, retryDecision, savedAnswers, score, selectionsFrom, sessionQuestions, tally, upsertAnswers } from './timing'
import { DAY } from './time'
import { inScope, manages } from './scope'
import { sharesFile } from './auditors'
import { dueExceptions } from './assignments'
import { assignmentExceptions } from './exceptions'
import { followOn } from './automation'
import { prerequisiteCompleted } from './due-rules'
import { surveyState } from './survey'

export async function loadAssignment(env: Bindings, actor: Actor, id: string, { manage = false } = {}) {
  const assignment = await one(env, 'SELECT a.*, c.title AS course_title FROM beam_assignments a JOIN beam_courses c ON c.id = a.course_id WHERE a.id = ?', id)
  // Another learner's assignment is indistinguishable from a missing one.
  if (!assignment || !(assignment.learner_id === actor.id || (manage && manages(actor, assignment.learner_id, 'enrollment', 'people')))) throw new BeamError('not_found', 404)
  return assignment
}

export async function prerequisiteMet(env: Bindings, assignment: any) {
  if (!assignment.prerequisite_course_id) return true
  return !!await one(env, 'SELECT 1 FROM beam_completions WHERE learner_id = ? AND course_id = ? AND (expires_at IS NULL OR expires_at > ?)', assignment.learner_id, assignment.prerequisite_course_id, now())
}

async function progress(env: Bindings, assignment: any) {
  const content = await revisionDetail(env, assignment.course_revision_id)
  const done = new Set((await all<{ lesson_revision_id: string }>(env, 'SELECT lesson_revision_id FROM beam_lesson_progress WHERE assignment_id = ?', assignment.id)).map(row => row.lesson_revision_id))
  // Attempts closed by a reset (LEARN-019) stay as history and no longer count.
  // AUTHOR-010: attempts of earlier assignments moved here with an unchanged assessment count too.
  const recorded = await all(env, `${ATTEMPT_CHAIN} SELECT id, kind, number, submitted_at AS submittedAt, score, max_score AS maxScore, passed, scoring_rule AS scoringRule, retry_decision AS retryDecision, state, evidence_text AS evidenceText, attachment_id AS attachment, reset_id AS reset, close_reason AS closeReason FROM beam_attempts WHERE assignment_id IN (SELECT id FROM chain) ORDER BY submitted_at`, assignment.id)
  const attempts = recorded.filter(attempt => !attempt.reset), earlier = recorded.filter(attempt => attempt.reset)
  const nextNumber = (kind: string) => recorded.filter(attempt => attempt.kind === kind).length + 1
  const assessment = content.assessment
  const quizAttempts = attempts.filter(attempt => attempt.kind === 'quiz')
  const allowed = assessment?.max_attempts ? assessment.max_attempts + assignment.extra_attempts : 0
  return {
    content, done, attempts, earlier, nextNumber,
    lessonsComplete: content.lessons.every(lesson => done.has(lesson.id)),
    quizRequired: !!assessment && assessment.questions.length > 0,
    quizPassed: quizAttempts.some(attempt => attempt.passed === 1),
    // LEARN-001: a quiz attempt with written answers waits for the named assessor before another can start.
    quizGrading: quizAttempts.some(attempt => attempt.state === 'awaiting_review'),
    quizAttemptsLeft: Math.max(0, allowed - quizAttempts.length),
    practicalRequired: !!assessment?.practical_instructions,
    practicalAccepted: attempts.some(attempt => attempt.kind === 'practical' && attempt.state === 'accepted'),
    practicalPending: attempts.some(attempt => attempt.kind === 'practical' && attempt.state === 'awaiting_review'),
    resumeLesson: content.lessons.find(lesson => lesson.id === assignment.last_lesson_id && !done.has(lesson.id)) ?? content.lessons.find(lesson => !done.has(lesson.id)) ?? null,
    attendance: await attendanceState(env, assignment.id, content.revision.attendance_percent),
  }
}

/** LIVE-003: a revision that requires attendance is met by the current attendance record of this assignment's session:
 * a "complete" decision with at least the revision's share of the session's scheduled minutes. Online parts and
 * attendance stay separate requirements; neither stands in for the other. */
export async function attendanceState(env: Bindings, assignment: string, percent: number | null) {
  if (percent === null) return { required: null, met: true, record: null }
  const record = await one(env, `${MOVE_CHAIN} SELECT t.id, t.session_id AS session, t.status, t.minutes, t.decision, s.minutes * s.meetings AS scheduled FROM beam_attendance t JOIN beam_sessions s ON s.id = t.session_id WHERE t.assignment_id IN (SELECT id FROM chain) AND t.superseded_at IS NULL ORDER BY t.recorded_at DESC LIMIT 1`, assignment)
  return { required: percent, record, met: !!record && record.decision === 'complete' && record.minutes * 100 >= percent * record.scheduled }
}

/** LEARN-001: the questions the next quiz attempt asks, drawn from the revision's bank for this assignment and attempt
 * number (question-types.ts drawQuestions), so the same attempt always shows the same questions. */
export function nextQuestions(assignment: Row, assessment: Row & { questions: Question[] }, number: number) {
  return drawQuestions(assessment.questions, { draw: assessment.draw_count ?? null, shuffle: assessment.shuffle === 1 }, `${assignment.id}:${number}`)
}

/** LEARN-018: a timed attempt past its deadline is closed at the deadline and scored from its saved answers. */
export async function closeExpired(env: Bindings, actor: Actor, assignmentId: string) {
  const session = await openSession(env, assignmentId)
  if (!session || now() < session.deadline) return
  const assignment = (await one(env, 'SELECT * FROM beam_assignments WHERE id = ?', assignmentId))!
  const state = await progress(env, assignment)
  const assessment = state.content.assessment!
  const closed = await closeSession(env, session, assessment.questions, assessment.pass_percent, state.quizAttemptsLeft, 'expired', session.deadline, assignment.learner_id)
  if (closed?.passed && assignment.status === 'open') await tryComplete(env, { ...actor, id: assignment.learner_id }, assignment.id)
  if (closed && !closed.passed) await followOn(env, 'failure', { assignment: assignment.id })
}

/** Closes every expired timed attempt, so reports count them as the attempts they are. */
export async function closeAllExpired(env: Bindings, actor: Actor) {
  for (const row of await all<{ assignment_id: string }>(env, 'SELECT assignment_id FROM beam_quiz_sessions WHERE closed_at IS NULL AND deadline <= ?', now())) await closeExpired(env, actor, row.assignment_id)
}

export async function assignmentView(env: Bindings, actor: Actor, id: string) {
  await loadAssignment(env, actor, id, { manage: true })
  // A read-only view (ORG-012) never scores an expired timed quiz; the learner's or a manager's next request does.
  if (!actor.viewAs) await closeExpired(env, actor, id)
  const assignment = await loadAssignment(env, actor, id, { manage: true })
  const state = await progress(env, assignment)
  const timed = state.quizRequired ? await timedView(env, assignment, state.content.assessment!) : null
  const learner = assignment.learner_id === actor.id
  const assessment = state.content.assessment
  const session = timed?.session ? await openSession(env, assignment.id) : null
  const asked = !state.quizRequired ? [] : session ? sessionQuestions(session, assessment!.questions) : nextQuestions(assignment, assessment!, state.nextNumber('quiz'))
  const completion = await one(env, 'SELECT c.*, k.id AS certificate FROM beam_completions c LEFT JOIN beam_certificates k ON k.completion_id = c.id WHERE c.assignment_id = ?', id)
  // Outside the access window (AUTO-009) the lesson text and quiz questions are not served; records stay readable.
  const access = await accessView(env, assignment), launchable = access.state === 'open'
  return {
    access,
    assignment: { id: assignment.id, course: assignment.course_id, courseTitle: assignment.course_title, revision: assignment.course_revision_id, revisionNumber: state.content.revision.number, status: assignment.status, dueDate: assignment.due_date, dueTime: assignment.due_time, timezone: assignment.timezone, dueAt: assignment.due_at, reason: assignment.reason, learner: assignment.learner_id, assignedBy: assignment.assigned_by, pathRevision: assignment.path_revision_id },
    blocked: !await prerequisiteMet(env, assignment),
    prerequisite: assignment.prerequisite_course_id,
    lessons: state.content.lessons.map(lesson => launchable ? { ...lesson, completed: state.done.has(lesson.id) } : { id: lesson.id, position: lesson.position, title: lesson.title, completed: state.done.has(lesson.id) }),
    resumeLesson: state.resumeLesson?.id ?? null,
    lessonsComplete: state.lessonsComplete,
    externalTools: await ltiRequirements(env, assignment),
    quiz: state.quizRequired ? { passPercent: assessment!.pass_percent, attemptsLeft: state.quizAttemptsLeft, passed: state.quizPassed, grading: state.quizGrading, bank: assessment!.questions.length, draw: assessment!.draw_count ?? null, shuffle: assessment!.shuffle === 1, feedback: assessment!.feedback ?? 'attempt', points: asked.reduce((sum, question) => sum + weightOf(question), 0), questions: (launchable ? asked : []).map(presentQuestion), ...timed! } : null,
    attendance: state.attendance.required === null ? null : { percent: state.attendance.required, met: state.attendance.met, record: state.attendance.record },
    survey: await surveyState(env, assignment.id, state.content.survey),
    practical: state.practicalRequired ? { instructions: state.content.assessment!.practical_instructions, assessor: state.content.assessment!.assessor_id, accepted: state.practicalAccepted, pending: state.practicalPending } : null,
    attempts: learner || isManager(actor) ? state.attempts : [],
    // LIVE-003: attendance records and their amendments, like attempts, for the learner and their managers.
    attendanceRecords: learner || isManager(actor) ? await attendanceRecords(env, assignment.id) : [],
    // Everything before each reset, marked with who reset it and why.
    resets: learner || isManager(actor) ? (await resetHistory(env, assignment.id)).map(reset => ({ ...reset, attempts: state.earlier.filter(attempt => attempt.reset === reset.id).map(attempt => ({ ...attempt, closedByReset: attempt.state === 'awaiting_review' }) as Row) })) : [],
    // AUTHOR-010: the moves that brought this assignment to its revision.
    moves: await movesOf(env, assignment.id),
    // ORG-004: every due-date exception, with the earlier due date, who approved it and why.
    dueExceptions: await dueExceptions(env, assignment.id),
    // AUTO-006: blockers the learner reported and every deferral or exemption, kept after they end.
    ...await assignmentExceptions(env, assignment.id),
    completion: completion ? { id: completion.id, method: completion.method, completedAt: completion.completed_at, expiresAt: completion.expires_at, certificate: completion.certificate, revision: completion.course_revision_id, assessmentRevision: completion.assessment_revision_id } : null,
  }
}

/** The time limit, the open attempt's clock and saved answers, and the accommodation that would apply to a new attempt. */
interface TimedView { timeLimitMinutes: number | null; extraMinutes: number; accommodation: Accommodation | null; session: { id: string; startedAt: number; deadline: number; timeLimitMinutes: number; extraMinutes: number; accommodation: Accommodation | null; answers: Record<string, Answer> } | null }

async function timedView(env: Bindings, assignment: Row, assessment: Row): Promise<TimedView> {
  const limit = assessment.time_limit_minutes as number | null
  if (!limit) return { timeLimitMinutes: null, extraMinutes: 0, session: null, accommodation: null }
  const [session, accommodation] = await Promise.all([openSession(env, assignment.id), accommodationFor(env, assignment.learner_id, assignment.course_id)])
  return {
    timeLimitMinutes: limit, accommodation, extraMinutes: extraMinutes(limit, accommodation),
    session: session ? { id: session.id, startedAt: session.started_at, deadline: session.deadline, timeLimitMinutes: session.time_limit_minutes, extraMinutes: session.extra_minutes, accommodation: session.accommodation_json ? JSON.parse(session.accommodation_json) : null, answers: Object.fromEntries(await savedAnswers(env, session.id)) } : null,
  }
}

async function learnerAssignment(env: Bindings, actor: Actor, input: Input) {
  await closeExpired(env, actor, (await loadAssignment(env, actor, input.text('assignment'))).id)
  const assignment = await loadAssignment(env, actor, input.text('assignment'))
  insist(assignment.status === 'open', 'assignment_closed', 409)
  requireAccess(assignment)
  insist(await prerequisiteMet(env, assignment), 'prerequisite_incomplete', 409)
  return assignment
}

export async function completeLesson(env: Bindings, actor: Actor, input: Input) {
  const assignment = await learnerAssignment(env, actor, input)
  const lesson = input.text('lesson')
  const { content } = await progress(env, assignment)
  const index = content.lessons.findIndex(candidate => candidate.id === lesson)
  insist(index >= 0, 'lesson_not_found', 404)
  const next = content.lessons[index + 1]?.id ?? null
  await commit(env, [
    stmt(env, 'INSERT OR IGNORE INTO beam_lesson_progress (assignment_id, lesson_revision_id, completed_at) VALUES (?, ?, ?)', assignment.id, lesson, now()),
    stmt(env, 'UPDATE beam_assignments SET last_lesson_id = ? WHERE id = ?', next, assignment.id),
  ], { actor, action: 'lesson.complete', subject: assignment.id, detail: { lesson } })
  const completion = await tryComplete(env, actor, assignment.id)
  return { next, completion }
}

/** Starts a timed quiz attempt on the server, or returns the one already running: leaving the page never stops its clock. */
export async function startQuiz(env: Bindings, actor: Actor, input: Input) {
  const assignment = await learnerAssignment(env, actor, input)
  const state = await quizState(env, assignment)
  const assessment = state.content.assessment!
  insist(assessment.time_limit_minutes, 'quiz_not_timed', 409)
  const running = await openSession(env, assignment.id)
  if (running) return { id: running.id, startedAt: running.started_at, deadline: running.deadline, resumed: true }
  const accommodation = await accommodationFor(env, assignment.learner_id, assignment.course_id)
  const extra = extraMinutes(assessment.time_limit_minutes, accommodation)
  const id = newId(), at = now(), deadline = deadlineFor(at, assessment.time_limit_minutes, extra)
  const asked = nextQuestions(assignment, assessment, state.nextNumber('quiz')).map(question => question.id)
  await commit(env, [stmt(env, 'INSERT INTO beam_quiz_sessions (id, assignment_id, assessment_revision_id, started_at, deadline, time_limit_minutes, extra_minutes, accommodation_json, question_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, assignment.id, assessment.id, at, deadline, assessment.time_limit_minutes, extra, accommodation ? JSON.stringify(accommodation) : null, JSON.stringify(asked))],
    { actor, action: 'quiz.start', subject: id, detail: { assignment: assignment.id, timeLimitMinutes: assessment.time_limit_minutes, extraMinutes: extra, accommodation: accommodation?.id ?? null, deadline } })
  return { id, startedAt: at, deadline, resumed: false }
}

/** Saves answers into the running timed attempt; after its deadline they are refused. */
export async function saveQuizAnswers(env: Bindings, actor: Actor, input: Input) {
  const assignment = await learnerAssignment(env, actor, input)
  const state = await quizState(env, assignment)
  const session = await openSession(env, assignment.id) ?? await refuseLate(env, assignment.id)
  const selections = selectionsFrom(sessionQuestions(session, state.content.assessment!.questions), input, { onlyPresent: true })
  const at = now()
  insist(at < session.deadline, 'time_expired', 409, { closedAt: session.deadline })
  if (selections.size) await env.DB.batch(upsertAnswers(env, session.id, selections, at))
  return { id: session.id, saved: selections.size, deadline: session.deadline }
}

async function quizState(env: Bindings, assignment: Row) {
  const state = await progress(env, assignment)
  insist(state.quizRequired, 'no_quiz', 409)
  insist(state.lessonsComplete, 'lessons_incomplete', 409)
  insist(!state.quizPassed, 'quiz_already_passed', 409)
  insist(!state.quizGrading, 'attempt_awaiting_grading', 409)
  insist(state.quizAttemptsLeft > 0, 'no_attempts_remaining', 409)
  return state
}

export async function submitQuiz(env: Bindings, actor: Actor, input: Input) {
  const assignment = await learnerAssignment(env, actor, input)
  const state = await quizState(env, assignment)
  const assessment = state.content.assessment!
  if (assessment.time_limit_minutes) {
    // A timed attempt scores what was saved into it, with these last answers saved first while time remains.
    const session = await openSession(env, assignment.id) ?? await refuseLate(env, assignment.id)
    const selections = selectionsFrom(sessionQuestions(session, assessment.questions), input, { onlyPresent: true })
    const at = now()
    insist(at < session.deadline, 'time_expired', 409, { closedAt: session.deadline })
    if (selections.size) await env.DB.batch(upsertAnswers(env, session.id, selections, at))
    const closed = await closeSession(env, session, assessment.questions, assessment.pass_percent, state.quizAttemptsLeft, 'submitted', at, actor.id)
    insist(closed, 'time_expired', 409)
    if (!closed.passed && !closed.pending) await followOn(env, 'failure', { assignment: assignment.id })
    return { ...closed, completion: await tryComplete(env, actor, assignment.id) }
  }
  const number = state.nextNumber('quiz')
  const asked = nextQuestions(assignment, assessment, number)
  const responses = score(asked, selectionsFrom(asked, input))
  const { points, max, percent, passed, pending } = tally(responses, assessment.pass_percent)
  const decision = pending ? AWAITING_GRADING : retryDecision(passed, state.quizAttemptsLeft - 1)
  const id = newId()
  await commit(env, [
    stmt(env, "INSERT INTO beam_attempts (id, assignment_id, assessment_revision_id, kind, number, submitted_at, score, max_score, passed, scoring_rule, retry_decision, state, question_ids_json) VALUES (?, ?, ?, 'quiz', ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, assignment.id, assessment.id, number, now(), points, max, pending ? null : passed ? 1 : 0, `${SCORING_RULE}; pass at ${assessment.pass_percent}%`, decision, pending ? 'awaiting_review' : 'scored', JSON.stringify(asked.map(question => question.id))),
    ...responseRows(env, id, responses),
  ], { actor, action: 'quiz.attempt', subject: id, detail: { assignment: assignment.id, points, of: max, passed, pending } })
  const completion = await tryComplete(env, actor, assignment.id)
  // AUTO-005: an attempt that leaves no attempts runs the course's failure rules; it never becomes a pass.
  if (!passed && !pending) await followOn(env, 'failure', { assignment: assignment.id })
  return { id, number, score: points, maxScore: max, percent, passed, pending, retryDecision: decision, completion }
}

/** LEARN-001: the named assessor of the attempt's revision grades its written answers, awarding each from 0 to its
 * weight with a note; the attempt is then scored like any other and may complete the course. */
export async function gradeQuiz(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'assessor')
  const attempt = await loadAttempt(env, input.text('attempt'))
  insist(attempt && attempt.kind === 'quiz', 'not_found', 404)
  insist(attempt.assessor_id === actor.id, 'named_assessor_required', 403)
  insist(attempt.learner_id !== actor.id, 'self_assessment_refused', 403)
  insist(!attempt.reset_id, 'attempt_closed_by_reset', 409)
  insist(attempt.state === 'awaiting_review', 'attempt_decided', 409)
  const responses = await all<{ question_id: string; weight: number; points: number | null }>(env, 'SELECT question_id, weight, points FROM beam_responses WHERE attempt_id = ?', attempt.id)
  const graded = responses.map(response => response.points !== null ? response : { ...response, points: input.integer(`points_${response.question_id}`, { min: 0, max: response.weight })!, awarded: true })
  const note = input.text('note', { max: 2000 })
  const assignment = (await one(env, 'SELECT * FROM beam_assignments WHERE id = ?', attempt.assignment_id))!
  const counting = await countingAssignment(env, attempt.assignment_id)
  const assessment = (await one<{ pass_percent: number }>(env, 'SELECT pass_percent FROM beam_assessment_revisions WHERE id = ?', attempt.assessment_revision_id))!
  const { points, max, passed } = tally(graded, assessment.pass_percent)
  const state = await progress(env, counting ? (await one(env, 'SELECT * FROM beam_assignments WHERE id = ?', counting))! : assignment)
  const decision = retryDecision(passed, state.quizAttemptsLeft)
  await commit(env, [
    ...graded.filter(response => 'awarded' in response).map(response => stmt(env, 'UPDATE beam_responses SET points = ?, correct = ? WHERE attempt_id = ? AND question_id = ?', response.points, response.points === response.weight ? 1 : 0, attempt.id, response.question_id)),
    stmt(env, 'INSERT INTO beam_quiz_gradings (attempt_id, assessor_id, note, graded_at) VALUES (?, ?, ?, ?)', attempt.id, actor.id, note, now()),
    stmt(env, "UPDATE beam_attempts SET state = 'scored', score = ?, max_score = ?, passed = ?, retry_decision = ? WHERE id = ? AND state = 'awaiting_review'", points, max, passed ? 1 : 0, decision, attempt.id),
  ], { actor, action: 'quiz.grade', subject: attempt.id, detail: { points, of: max, passed, note } })
  const completion = counting ? await tryComplete(env, actor, counting) : null
  if (!passed) await followOn(env, 'failure', { assignment: attempt.assignment_id })
  return { id: attempt.id, score: points, maxScore: max, passed, retryDecision: decision, completion }
}

export async function submitPractical(env: Bindings, actor: Actor, input: Input) {
  const assignment = await learnerAssignment(env, actor, input)
  const state = await progress(env, assignment)
  insist(state.practicalRequired, 'no_practical', 409)
  insist(state.lessonsComplete, 'lessons_incomplete', 409)
  insist(!state.practicalAccepted && !state.practicalPending, 'practical_not_open', 409)
  const evidence = input.text('evidence', { max: 10_000 })
  const file = await input.file('file', { optional: true })
  const attachment = file ? { id: newId(), ...await store(env, file) } : null
  const id = newId()
  const number = state.nextNumber('practical')
  await commit(env, [
    ...(attachment ? [stmt(env, 'INSERT INTO beam_attachments (id, filename, media_type, size, sha256, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)', attachment.id, attachment.filename, attachment.mediaType, attachment.size, attachment.sha256, actor.id, now())] : []),
    stmt(env, "INSERT INTO beam_attempts (id, assignment_id, assessment_revision_id, kind, number, submitted_at, scoring_rule, retry_decision, state, evidence_text, attachment_id) VALUES (?, ?, ?, 'practical', ?, ?, 'named assessor decision', 'awaiting the named assessor', 'awaiting_review', ?, ?)", id, assignment.id, state.content.assessment!.id, number, now(), evidence, attachment?.id ?? null),
  ], { actor, action: 'practical.submit', subject: id, detail: { assignment: assignment.id, attachment: attachment?.sha256 ?? null } })
  return { id, number, state: 'awaiting_review' }
}

async function loadAttempt(env: Bindings, id: string) {
  return await one(env, 'SELECT t.*, a.learner_id, a.status AS assignment_status, s.assessor_id FROM beam_attempts t JOIN beam_assignments a ON a.id = t.assignment_id JOIN beam_assessment_revisions s ON s.id = t.assessment_revision_id WHERE t.id = ?', id)
}

export async function decidePractical(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'assessor')
  const attempt = await loadAttempt(env, input.text('attempt'))
  insist(attempt && attempt.kind === 'practical', 'not_found', 404)
  insist(attempt.assessor_id === actor.id, 'named_assessor_required', 403)
  // Nobody signs off their own evidence: the owner or a reassigned assessor decides it.
  insist(attempt.learner_id !== actor.id, 'self_assessment_refused', 403)
  insist(!attempt.reset_id, 'attempt_closed_by_reset', 409)
  insist(attempt.state === 'awaiting_review', 'attempt_decided', 409)
  const decision = input.text('decision')
  insist(decision === 'accepted' || decision === 'rejected', 'invalid_decision')
  const note = input.text('note', { max: 2000 })
  await commit(env, [
    stmt(env, 'INSERT INTO beam_review_decisions (id, attempt_id, assessor_id, decision, note, decided_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), attempt.id, actor.id, decision, note, now()),
    stmt(env, "UPDATE beam_attempts SET state = ?, passed = ?, retry_decision = ? WHERE id = ? AND state = 'awaiting_review'", decision, decision === 'accepted' ? 1 : 0, decision === 'accepted' ? 'accepted by the named assessor' : 'resubmission allowed', attempt.id),
  ], { actor, action: `practical.${decision}`, subject: attempt.id, detail: { note } })
  // AUTHOR-010: a practical carried over by a move counts on the assignment it was moved to.
  const counting = await countingAssignment(env, attempt.assignment_id)
  const completion = counting ? await tryComplete(env, actor, counting) : null
  return { id: attempt.id, decision, completion }
}

/** One attempt: its learner, managers, and the named assessor of a practical attempt or of written answers. Everyone else
 * gets 404. LEARN-001: the learner sees which questions were right as the revision's feedback timing allows (with each
 * attempt; once they passed or have no attempts left; or never, score only); managers and the assessor always do. */
export async function attemptDetail(env: Bindings, actor: Actor, id: string) {
  const attempt = await loadAttempt(env, id)
  const graded = attempt && actor.roles.has('assessor') && attempt.assessor_id === actor.id && (attempt.kind === 'practical' || attempt.state === 'awaiting_review' || !!await one(env, 'SELECT 1 FROM beam_quiz_gradings WHERE attempt_id = ?', id))
  const allowed = attempt && (attempt.learner_id === actor.id || (isManager(actor) && inScope(actor, attempt.learner_id)) || graded)
  if (!allowed) throw new BeamError('not_found', 404)
  const rows = await all(env, 'SELECT question_id AS question, answer_json AS answer, correct, weight, points FROM beam_responses WHERE attempt_id = ?', id)
  const order: string[] = attempt.question_ids_json ? JSON.parse(attempt.question_ids_json) : rows.map(row => row.question)
  const bank = new Map(((await revisionDetail(env, (await one(env, 'SELECT course_revision_id FROM beam_assessment_revisions WHERE id = ?', attempt.assessment_revision_id))!.course_revision_id)).assessment?.questions ?? []).map(question => [question.id, question]))
  const learnerOnly = attempt.learner_id === actor.id && !isManager(actor)
  const feedback = learnerOnly ? await feedbackShown(env, attempt) : true
  const responses = order.map(question => rows.find(row => row.question === question)).filter(Boolean).map(row => ({ question: row!.question, prompt: bank.get(row!.question)?.prompt ?? '', kind: bank.get(row!.question)?.kind ?? 'choice', answer: JSON.parse(row!.answer), weight: row!.weight, ...(feedback ? { correct: row!.correct, points: row!.points } : {}) }))
  const decision = await one(env, 'SELECT assessor_id AS assessor, decision, note, decided_at AS decidedAt FROM beam_review_decisions WHERE attempt_id = ?', id)
    ?? await one(env, "SELECT assessor_id AS assessor, 'graded' AS decision, note, graded_at AS decidedAt FROM beam_quiz_gradings WHERE attempt_id = ?", id)
  return { id, assignment: attempt.assignment_id, learner: attempt.learner_id, kind: attempt.kind, number: attempt.number, score: attempt.score, maxScore: attempt.max_score, passed: attempt.passed, scoringRule: attempt.scoring_rule, retryDecision: attempt.retry_decision, state: attempt.state, evidence: attempt.evidence_text, attachment: attempt.attachment_id, reset: attempt.reset_id ? await one(env, 'SELECT r.id, r.reason, r.reset_at AS resetAt, r.reset_by AS resetBy FROM beam_assignment_resets r WHERE r.id = ?', attempt.reset_id) : null, responses, feedback: feedback ? 'shown' : 'withheld', assessor: attempt.assessor_id, decision,
    timing: attempt.time_limit_minutes ? { timeLimitMinutes: attempt.time_limit_minutes, extraMinutes: attempt.extra_minutes, accommodation: attempt.accommodation_json ? JSON.parse(attempt.accommodation_json) : null, startedAt: attempt.started_at, closedAt: attempt.closed_at, closeReason: attempt.close_reason } : null }
}

/** Whether the learner may see which questions of this attempt were right, under its revision's feedback timing. */
async function feedbackShown(env: Bindings, attempt: Row) {
  const timing = (await one<{ feedback: string }>(env, 'SELECT feedback FROM beam_assessment_revisions WHERE id = ?', attempt.assessment_revision_id))?.feedback ?? 'attempt'
  if (timing === 'attempt') return true
  if (timing === 'score') return false
  const counting = await countingAssignment(env, attempt.assignment_id) ?? attempt.assignment_id
  const state = await progress(env, (await one(env, 'SELECT * FROM beam_assignments WHERE id = ?', counting))!)
  return state.quizPassed || (state.quizAttemptsLeft === 0 && !state.quizGrading)
}

export async function attachmentFile(env: Bindings, actor: Actor, id: string) {
  const file = await one(env, 'SELECT filename, media_type AS mediaType, size, sha256 FROM beam_attachments WHERE id = ?', id)
  const attempt = await one(env, 'SELECT id FROM beam_attempts WHERE attachment_id = ?', id)
  // LIVE-003: attendance evidence goes to its learner, their managers for their own teams (as offline-session files do)
  // and whoever keeps that session's roster.
  const attendance = await one(env, 'SELECT session_id, learner_id FROM beam_attendance WHERE attachment_id = ?', id)
  if (file && attendance && (attendance.learner_id === actor.id || (isManager(actor) && inScope(actor, attendance.learner_id)) || await keepsRoster(env, actor, attendance.session_id))) return serve(env, file as never, { download: true })
  // An attempt's file follows the attempt; an offline session's file goes to managers of someone it completed.
  // An auditor's shared evidence is checked file by file (ORG-005).
  const allowed = file && (await sharesFile(env, actor, id) || (attempt ? await attemptDetail(env, actor, attempt.id).then(() => true, () => false)
    : isManager(actor) && (actor.learners === null || (await all<{ learner_id: string }>(env, "SELECT learner_id FROM beam_completions WHERE json_extract(evidence_json, '$.attachment') = ?", id)).some(row => inScope(actor, row.learner_id)))))
  if (!allowed) throw new BeamError('not_found', 404)
  return serve(env, file as never, { download: true })
}

/** Records completion once every requirement of the exact assigned revision is met. */
export async function tryComplete(env: Bindings, actor: Actor, assignmentId: string) {
  const assignment = await one(env, "SELECT * FROM beam_assignments WHERE id = ? AND status = 'open'", assignmentId)
  if (!assignment) return null
  const state = await progress(env, assignment)
  const externalTools = await ltiRequirements(env, assignment)
  if (externalTools.some(tool => !tool.passed) || !state.lessonsComplete || (state.quizRequired && !state.quizPassed) || (state.practicalRequired && !state.practicalAccepted) || !state.attendance.met) return null
  const assessment = state.content.assessment
  const quiz = state.attempts.find(attempt => attempt.kind === 'quiz' && attempt.passed === 1)
  const practical = state.attempts.find(attempt => attempt.kind === 'practical' && attempt.state === 'accepted')
  const evidence = { ...(externalTools.length ? { externalTools: externalTools.map(tool => ({ resource: tool.resource, lineitem: tool.lineitem, result: tool.result, revision: assignment.course_revision_id })) } : {}), lessons: state.content.lessons.map(lesson => lesson.id), quizAttempt: quiz?.id ?? null, practicalAttempt: practical?.id ?? null, ...(state.attendance.record ? { attendance: state.attendance.record.id } : {}) }
  return await recordCompletion(env, actor, { assignment: assignment.id, learner: assignment.learner_id, course: assignment.course_id, revision: assignment.course_revision_id, assessmentRevision: assessment?.id ?? null, method: assessment ? 'assessed' : 'lessons', evidence, renewalDays: assignment.renewal_days })
}

export async function recordCompletion(env: Bindings, actor: Actor, item: { assignment: string | null; learner: string; course: string; revision: string; assessmentRevision: string | null; method: 'lessons' | 'assessed' | 'offline'; evidence: unknown; renewalDays: number | null; completedAt?: number }) {
  // A linked completion must describe exactly the assignment it closes.
  if (item.assignment) {
    const assignment = await one(env, 'SELECT * FROM beam_assignments WHERE id = ?', item.assignment)
    insist(assignment && assignment.status === 'open' && assignment.learner_id === item.learner && assignment.course_id === item.course && assignment.course_revision_id === item.revision, 'completion_assignment_mismatch', 409)
    item.renewalDays = assignment.renewal_days
  }
  const business = await requireBusiness(env)
  const id = newId(), at = item.completedAt ?? now()
  const expires = item.renewalDays ? at + item.renewalDays * DAY : null
  const certificate = { id: newId(), number: `${new Date(at).getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}` }
  await commit(env, [
    stmt(env, 'INSERT INTO beam_completions (id, assignment_id, learner_id, course_id, course_revision_id, assessment_revision_id, method, evidence_json, completed_at, expires_at, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, item.assignment, item.learner, item.course, item.revision, item.assessmentRevision, item.method, JSON.stringify(item.evidence), at, expires, actor.id),
    ...(item.assignment ? [stmt(env, "UPDATE beam_assignments SET status = 'completed' WHERE id = ? AND status = 'open'", item.assignment)] : []),
    stmt(env, 'INSERT INTO beam_notification_events(completion_id,at) VALUES(?,?)', id, now()),
    // LEARN-002: the certificate keeps the template its course names now.
    stmt(env, 'INSERT INTO beam_certificates (id, completion_id, number, issuer, issued_at, expires_at, template_id) VALUES (?, ?, ?, ?, ?, ?, (SELECT certificate_template_id FROM beam_courses WHERE id = ?))', certificate.id, id, certificate.number, business.name, now(), expires, item.course),
  ], { actor, action: 'completion.record', subject: id, detail: { ...item, certificate: certificate.number } })
  await prerequisiteCompleted(env, item.learner, item.course, at, actor.id)
  await followOn(env, 'completion', { completion: id })
  await completionNotifications(env, id)
  return { id, certificate: certificate.id, expiresAt: expires }
}
