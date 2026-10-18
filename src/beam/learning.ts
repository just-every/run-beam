// Flows 6-9: learners resume lessons, take deterministic quizzes and submit
// practical evidence; completion is recorded only when every requirement of the
// exact assigned revision is met, and is bound to that revision.
import type { Bindings } from '../auth.server'
import { isManager, requireRole, type Actor } from './actor'
import { revisionDetail, type Question } from './courses'
import { BeamError, all, commit, insist, newId, now, one, stmt, type Row } from './core'
import { serve, store } from './files'
import type { Input } from './input'
import { requireBusiness } from './people'
import { resetHistory } from './resets'
import { DAY } from './time'

export async function loadAssignment(env: Bindings, actor: Actor, id: string, { manage = false } = {}) {
  const assignment = await one(env, 'SELECT a.*, c.title AS course_title FROM beam_assignments a JOIN beam_courses c ON c.id = a.course_id WHERE a.id = ?', id)
  // Another learner's assignment is indistinguishable from a missing one.
  if (!assignment || !(assignment.learner_id === actor.id || (manage && isManager(actor)))) throw new BeamError('not_found', 404)
  return assignment
}

async function prerequisiteMet(env: Bindings, assignment: any) {
  if (!assignment.prerequisite_course_id) return true
  return !!await one(env, 'SELECT 1 FROM beam_completions WHERE learner_id = ? AND course_id = ? AND (expires_at IS NULL OR expires_at > ?)', assignment.learner_id, assignment.prerequisite_course_id, now())
}

async function progress(env: Bindings, assignment: any) {
  const content = await revisionDetail(env, assignment.course_revision_id)
  const done = new Set((await all<{ lesson_revision_id: string }>(env, 'SELECT lesson_revision_id FROM beam_lesson_progress WHERE assignment_id = ?', assignment.id)).map(row => row.lesson_revision_id))
  // Attempts closed by a reset (LEARN-019) stay as history and no longer count.
  const recorded = await all(env, 'SELECT id, kind, number, submitted_at AS submittedAt, score, max_score AS maxScore, passed, scoring_rule AS scoringRule, retry_decision AS retryDecision, state, evidence_text AS evidenceText, attachment_id AS attachment, reset_id AS reset FROM beam_attempts WHERE assignment_id = ? ORDER BY submitted_at', assignment.id)
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
    quizAttemptsLeft: Math.max(0, allowed - quizAttempts.length),
    practicalRequired: !!assessment?.practical_instructions,
    practicalAccepted: attempts.some(attempt => attempt.kind === 'practical' && attempt.state === 'accepted'),
    practicalPending: attempts.some(attempt => attempt.kind === 'practical' && attempt.state === 'awaiting_review'),
    resumeLesson: content.lessons.find(lesson => lesson.id === assignment.last_lesson_id && !done.has(lesson.id)) ?? content.lessons.find(lesson => !done.has(lesson.id)) ?? null,
  }
}

export async function assignmentView(env: Bindings, actor: Actor, id: string) {
  const assignment = await loadAssignment(env, actor, id, { manage: true })
  const state = await progress(env, assignment)
  const learner = assignment.learner_id === actor.id
  const completion = await one(env, 'SELECT c.*, k.id AS certificate FROM beam_completions c LEFT JOIN beam_certificates k ON k.completion_id = c.id WHERE c.assignment_id = ?', id)
  return {
    assignment: { id: assignment.id, course: assignment.course_id, courseTitle: assignment.course_title, revision: assignment.course_revision_id, revisionNumber: state.content.revision.number, status: assignment.status, dueDate: assignment.due_date, dueTime: assignment.due_time, timezone: assignment.timezone, dueAt: assignment.due_at, reason: assignment.reason, learner: assignment.learner_id, pathRevision: assignment.path_revision_id },
    blocked: !await prerequisiteMet(env, assignment),
    prerequisite: assignment.prerequisite_course_id,
    lessons: state.content.lessons.map(lesson => ({ ...lesson, completed: state.done.has(lesson.id) })),
    resumeLesson: state.resumeLesson?.id ?? null,
    lessonsComplete: state.lessonsComplete,
    quiz: state.quizRequired ? { passPercent: state.content.assessment!.pass_percent, attemptsLeft: state.quizAttemptsLeft, passed: state.quizPassed, questions: state.content.assessment!.questions.map(question => ({ id: question.id, prompt: question.prompt, choices: question.choices, multiple: question.correct.length > 1 })) } : null,
    practical: state.practicalRequired ? { instructions: state.content.assessment!.practical_instructions, assessor: state.content.assessment!.assessor_id, accepted: state.practicalAccepted, pending: state.practicalPending } : null,
    attempts: learner || isManager(actor) ? state.attempts : [],
    // Everything before each reset, marked with who reset it and why.
    resets: learner || isManager(actor) ? (await resetHistory(env, assignment.id)).map(reset => ({ ...reset, attempts: state.earlier.filter(attempt => attempt.reset === reset.id).map(attempt => ({ ...attempt, closedByReset: attempt.state === 'awaiting_review' }) as Row) })) : [],
    completion: completion ? { id: completion.id, method: completion.method, completedAt: completion.completed_at, expiresAt: completion.expires_at, certificate: completion.certificate, revision: completion.course_revision_id, assessmentRevision: completion.assessment_revision_id } : null,
  }
}

async function learnerAssignment(env: Bindings, actor: Actor, input: Input) {
  const assignment = await loadAssignment(env, actor, input.text('assignment'))
  insist(assignment.status === 'open', 'assignment_closed', 409)
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
  ], { actor: actor.id, action: 'lesson.complete', subject: assignment.id, detail: { lesson } })
  const completion = await tryComplete(env, actor, assignment.id)
  return { next, completion }
}

/** Exact-set scoring: a question scores one point only when the selected choices equal the correct choices. */
function score(questions: Question[], input: Input) {
  return questions.map(question => {
    const selected = [...new Set(input.list(`q_${question.id}`).map(Number))].sort((a, b) => a - b)
    insist(selected.every(index => Number.isInteger(index) && index >= 0 && index < question.choices.length), 'invalid_answer')
    return { question: question.id, selected, correct: selected.length === question.correct.length && selected.every((value, index) => value === question.correct[index]) }
  })
}

export async function submitQuiz(env: Bindings, actor: Actor, input: Input) {
  const assignment = await learnerAssignment(env, actor, input)
  const state = await progress(env, assignment)
  insist(state.quizRequired, 'no_quiz', 409)
  insist(state.lessonsComplete, 'lessons_incomplete', 409)
  insist(!state.quizPassed, 'quiz_already_passed', 409)
  insist(state.quizAttemptsLeft > 0, 'no_attempts_remaining', 409)
  const assessment = state.content.assessment!
  const responses = score(assessment.questions, input)
  const points = responses.filter(response => response.correct).length
  const percent = Math.floor(points * 100 / responses.length)
  const passed = percent >= assessment.pass_percent
  const number = state.nextNumber('quiz')
  const left = state.quizAttemptsLeft - 1
  const decision = passed ? 'passed' : left > 0 ? `retry allowed: ${left} attempt${left === 1 ? '' : 's'} remaining` : 'no attempts remaining: a manager may grant another attempt'
  const id = newId()
  await commit(env, [
    stmt(env, "INSERT INTO beam_attempts (id, assignment_id, assessment_revision_id, kind, number, submitted_at, score, max_score, passed, scoring_rule, retry_decision, state) VALUES (?, ?, ?, 'quiz', ?, ?, ?, ?, ?, ?, ?, 'scored')", id, assignment.id, assessment.id, number, now(), points, responses.length, passed ? 1 : 0, `exact choice match per question; pass at ${assessment.pass_percent}%`, decision),
    ...responses.map(response => stmt(env, 'INSERT INTO beam_responses (attempt_id, question_id, answer_json, correct) VALUES (?, ?, ?, ?)', id, response.question, JSON.stringify(response.selected), response.correct ? 1 : 0)),
  ], { actor: actor.id, action: 'quiz.attempt', subject: id, detail: { assignment: assignment.id, points, of: responses.length, passed } })
  const completion = await tryComplete(env, actor, assignment.id)
  return { id, number, score: points, maxScore: responses.length, percent, passed, retryDecision: decision, completion }
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
  ], { actor: actor.id, action: 'practical.submit', subject: id, detail: { assignment: assignment.id, attachment: attachment?.sha256 ?? null } })
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
  ], { actor: actor.id, action: `practical.${decision}`, subject: attempt.id, detail: { note } })
  const completion = attempt.assignment_status === 'open' ? await tryComplete(env, actor, attempt.assignment_id) : null
  return { id: attempt.id, decision, completion }
}

/** One attempt: its learner, managers, and the named assessor of a practical attempt. Everyone else gets 404. */
export async function attemptDetail(env: Bindings, actor: Actor, id: string) {
  const attempt = await loadAttempt(env, id)
  const allowed = attempt && (attempt.learner_id === actor.id || isManager(actor) || (attempt.kind === 'practical' && actor.roles.has('assessor') && attempt.assessor_id === actor.id))
  if (!allowed) throw new BeamError('not_found', 404)
  const responses = await all(env, 'SELECT question_id AS question, answer_json AS answer, correct FROM beam_responses WHERE attempt_id = ?', id)
  const decision = await one(env, 'SELECT assessor_id AS assessor, decision, note, decided_at AS decidedAt FROM beam_review_decisions WHERE attempt_id = ?', id)
  return { id, assignment: attempt.assignment_id, learner: attempt.learner_id, kind: attempt.kind, number: attempt.number, score: attempt.score, maxScore: attempt.max_score, passed: attempt.passed, scoringRule: attempt.scoring_rule, retryDecision: attempt.retry_decision, state: attempt.state, evidence: attempt.evidence_text, attachment: attempt.attachment_id, reset: attempt.reset_id ? await one(env, 'SELECT r.id, r.reason, r.reset_at AS resetAt, r.reset_by AS resetBy FROM beam_assignment_resets r WHERE r.id = ?', attempt.reset_id) : null, responses: responses.map(response => ({ ...response, answer: JSON.parse(response.answer) })), decision }
}

export async function attachmentFile(env: Bindings, actor: Actor, id: string) {
  const file = await one(env, 'SELECT filename, media_type AS mediaType, size, sha256 FROM beam_attachments WHERE id = ?', id)
  const attempt = await one(env, 'SELECT id FROM beam_attempts WHERE attachment_id = ?', id)
  const allowed = file && (isManager(actor) || (attempt && await attemptDetail(env, actor, attempt.id).then(() => true, () => false)))
  if (!allowed) throw new BeamError('not_found', 404)
  return serve(env, file as never, { download: true })
}

/** Records completion once every requirement of the exact assigned revision is met. */
export async function tryComplete(env: Bindings, actor: Actor, assignmentId: string) {
  const assignment = await one(env, "SELECT * FROM beam_assignments WHERE id = ? AND status = 'open'", assignmentId)
  if (!assignment) return null
  const state = await progress(env, assignment)
  if (!state.lessonsComplete || (state.quizRequired && !state.quizPassed) || (state.practicalRequired && !state.practicalAccepted)) return null
  const assessment = state.content.assessment
  const quiz = state.attempts.find(attempt => attempt.kind === 'quiz' && attempt.passed === 1)
  const practical = state.attempts.find(attempt => attempt.kind === 'practical' && attempt.state === 'accepted')
  const evidence = { lessons: state.content.lessons.map(lesson => lesson.id), quizAttempt: quiz?.id ?? null, practicalAttempt: practical?.id ?? null }
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
    stmt(env, 'INSERT INTO beam_certificates (id, completion_id, number, issuer, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', certificate.id, id, certificate.number, business.name, now(), expires),
  ], { actor: actor.id, action: 'completion.record', subject: id, detail: { ...item, certificate: certificate.number } })
  return { id, certificate: certificate.id, expiresAt: expires }
}
