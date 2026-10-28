// LEARN-018 and LEARN-024: time-limited assessments. A timed quiz attempt starts on the
// server and its clock keeps running whether or not the learner is on the page.
// Answers are saved into the attempt until its deadline; at expiry the server
// closes it and scores only what was saved, and any later answer is refused
// through every door. A recorded accommodation (LEARN-011), granted by the owner
// or by a manager for people in one of their teams, adds minutes or a
// percentage, per course or for all assessments, and is stored on the attempt.
import type { Bindings } from '../auth.server'
import { requireRole, type Actor } from './actor'
import type { Question } from './courses'
import { SCORING_RULE, answerFrom, answered, isCorrect, weightOf, type Answer } from './question-types'
import { BeamError, all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { withinTeam } from './resets'

const MINUTE = 60_000

export interface Accommodation { id: string; kind: 'minutes' | 'percent'; amount: number; course: string | null; note: string; grantedBy: string; grantedByName: string; grantedAt: number }

export async function grantAccommodation(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'manager')
  const learner = input.text('learner')
  insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', learner), 'person_not_found', 404)
  insist(await withinTeam(env, actor, learner), 'learner_outside_your_team', 403)
  const course = input.text('course', { optional: true }) || null
  insist(!course || await one(env, 'SELECT 1 FROM beam_courses WHERE id = ?', course), 'course_not_found', 404)
  const kind = input.text('kind')
  insist(kind === 'minutes' || kind === 'percent', 'invalid_kind')
  const amount = input.integer('amount', { min: 1, max: kind === 'minutes' ? 600 : 400 })!
  const note = input.text('note', { max: 500, optional: true })
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_accommodations (id, learner_id, course_id, kind, amount, note, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, learner, course, kind, amount, note, actor.id, now())],
    { actor, action: 'accommodation.grant', subject: learner, detail: { id, course, kind, amount, note } })
  return { id }
}

/** Every accommodation granted to a learner, newest first; the newest for a course, else the newest for all, applies. */
export async function accommodations(env: Bindings, learner: string): Promise<Accommodation[]> {
  return await all<Accommodation>(env, 'SELECT a.id, a.kind, a.amount, a.course_id AS course, a.note, a.granted_by AS grantedBy, m.name AS grantedByName, a.granted_at AS grantedAt FROM beam_accommodations a JOIN beam_members m ON m.id = a.granted_by WHERE a.learner_id = ? ORDER BY a.granted_at DESC, a.rowid DESC', learner)
}

export async function accommodationFor(env: Bindings, learner: string, course: string) {
  const granted = await accommodations(env, learner)
  return granted.find(row => row.course === course) ?? granted.find(row => row.course === null) ?? null
}

export const extraMinutes = (limit: number, accommodation: Accommodation | null) =>
  !accommodation ? 0 : accommodation.kind === 'minutes' ? accommodation.amount : Math.ceil(limit * accommodation.amount / 100)

export async function openSession(env: Bindings, assignmentId: string) {
  return await one(env, 'SELECT * FROM beam_quiz_sessions WHERE assignment_id = ? AND closed_at IS NULL', assignmentId)
}

export async function savedAnswers(env: Bindings, sessionId: string) {
  return new Map((await all<{ question_id: string; answer_json: string }>(env, 'SELECT question_id, answer_json FROM beam_quiz_session_answers WHERE session_id = ?', sessionId)).map(row => [row.question_id, JSON.parse(row.answer_json) as Answer]))
}

/** The learner's answer to each question named in the input, checked against its type (question-types.ts). */
export function selectionsFrom(questions: Question[], input: Input, { onlyPresent = false } = {}) {
  const selections = new Map<string, Answer>()
  for (const question of questions) if (!onlyPresent || answered(question, input)) selections.set(question.id, answerFrom(question, input))
  return selections
}

export interface Scored { question: string; selected: Answer; correct: boolean; weight: number; points: number | null }

/** A question earns its weight only when its whole answer is right (LEARN-015, BEAM-07, LEARN-001); an unanswered
 * question scores none. A written answer waits for the named assessor (points null), unless it was left empty. */
export function score(questions: Question[], selections: Map<string, Answer>): Scored[] {
  return questions.map(question => {
    const selected = selections.get(question.id) ?? []
    const correct = isCorrect(question, selections.get(question.id)), weight = weightOf(question)
    const pending = question.kind === 'text' && typeof selected[0] === 'string' && selected[0].trim() !== ''
    return { question: question.id, selected, correct, weight, points: pending ? null : correct ? weight : 0 }
  })
}

/** Points earned and possible, the percent (rounded down) and whether a written answer still waits for grading. */
export function tally(responses: Pick<Scored, 'points' | 'weight'>[], passPercent: number) {
  const points = responses.reduce((sum, response) => sum + (response.points ?? 0), 0), max = responses.reduce((sum, response) => sum + response.weight, 0)
  const percent = max ? Math.floor(points * 100 / max) : 0, pending = responses.some(response => response.points === null)
  return { points, max, percent, pending, passed: !pending && percent >= passPercent }
}

export const retryDecision = (passed: boolean, left: number) => passed ? 'passed' : left > 0 ? `retry allowed: ${left} attempt${left === 1 ? '' : 's'} remaining` : 'no attempts remaining: a manager may grant another attempt'
export const AWAITING_GRADING = 'awaiting the named assessor’s grading of the written answers'

/** Each response with its weight and the points it earned (null until a written answer is graded). */
export const responseRows = (env: Bindings, attempt: string, responses: Scored[], guarded = false) => responses.map(response => stmt(env, `INSERT INTO beam_responses (attempt_id, question_id, answer_json, correct, weight, points) SELECT ?, ?, ?, ?, ?, ?${guarded ? ' WHERE EXISTS (SELECT 1 FROM beam_attempts WHERE id = ?)' : ''}`, attempt, response.question, JSON.stringify(response.selected), response.correct ? 1 : 0, response.weight, response.points, ...(guarded ? [attempt] : [])))

export function upsertAnswers(env: Bindings, sessionId: string, selections: Map<string, Answer>, at: number) {
  return [...selections].map(([question, selected]) => stmt(env, 'INSERT INTO beam_quiz_session_answers (session_id, question_id, answer_json, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT (session_id, question_id) DO UPDATE SET answer_json = excluded.answer_json, saved_at = excluded.saved_at', sessionId, question, JSON.stringify(selected), at))
}

/** The questions a timed session asks: those drawn when it started (LEARN-001), else the whole bank. */
export const sessionQuestions = (session: Row, bank: Question[]) => {
  if (!session.question_ids_json) return bank
  const byId = new Map(bank.map(question => [question.id, question]))
  return (JSON.parse(session.question_ids_json) as string[]).map(id => byId.get(id)!).filter(Boolean)
}

/** Closes an open session at `at` (its deadline when it expired) and writes its scored attempt from the saved answers. */
export async function closeSession(env: Bindings, session: Row, bank: Question[], passPercent: number, attemptsLeft: number, reason: 'submitted' | 'expired', at: number, actor: string) {
  const questions = sessionQuestions(session, bank)
  const responses = score(questions, await savedAnswers(env, session.id))
  const { points, max, percent, passed, pending } = tally(responses, passPercent)
  const recorded = await one<{ n: number }>(env, "SELECT COUNT(*) AS n FROM beam_attempts WHERE assignment_id = ? AND kind = 'quiz'", session.assignment_id)
  const number = (recorded?.n ?? 0) + 1
  const left = attemptsLeft - 1
  const decision = pending ? AWAITING_GRADING : retryDecision(passed, left)
  const id = newId()
  const rule = `${SCORING_RULE}; pass at ${passPercent}%; time limit ${session.time_limit_minutes} minutes${session.extra_minutes ? ` plus ${session.extra_minutes} minutes extra time` : ''}; only answers saved before the limit count`
  // The attempt is written first, only while the session is open; a concurrent closer's attempt number collides and loses.
  const statements = [
    stmt(env, `INSERT INTO beam_attempts (id, assignment_id, assessment_revision_id, kind, number, submitted_at, score, max_score, passed, scoring_rule, retry_decision, state, started_at, closed_at, close_reason, time_limit_minutes, extra_minutes, accommodation_json, question_ids_json)
      SELECT ?, ?, ?, 'quiz', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM beam_quiz_sessions WHERE id = ? AND closed_at IS NULL)`,
      id, session.assignment_id, session.assessment_revision_id, number, at, points, max, pending ? null : passed ? 1 : 0, rule, decision, pending ? 'awaiting_review' : 'scored', session.started_at, at, reason, session.time_limit_minutes, session.extra_minutes, session.accommodation_json, JSON.stringify(questions.map(question => question.id)), session.id),
    stmt(env, 'UPDATE beam_quiz_sessions SET closed_at = ?, close_reason = ?, attempt_id = ? WHERE id = ? AND closed_at IS NULL AND EXISTS (SELECT 1 FROM beam_attempts WHERE id = ?)', at, reason, id, session.id, id),
    ...responseRows(env, id, responses, true),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM beam_attempts WHERE id = ?)', now(), actor, reason === 'expired' ? 'quiz.expire' : 'quiz.attempt', id, JSON.stringify({ assignment: session.assignment_id, session: session.id, points, of: max, passed, pending, closedAt: at }), id),
  ]
  const claimed = await env.DB.batch(statements).catch(async error => {
    if (await one(env, 'SELECT 1 FROM beam_quiz_sessions WHERE id = ? AND closed_at IS NOT NULL', session.id)) return null
    throw error
  })
  if (!claimed || claimed[0].meta.changes !== 1) return null
  return { id, number, score: points, maxScore: max, percent, passed, pending, retryDecision: decision }
}

/** A timed answer or submission after the deadline: refused, naming when the attempt closed. */
export async function refuseLate(env: Bindings, assignmentId: string): Promise<never> {
  const latest = await one(env, 'SELECT close_reason, closed_at FROM beam_quiz_sessions WHERE assignment_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1', assignmentId)
  if (latest?.close_reason === 'expired') throw new BeamError('time_expired', 409, { closedAt: latest.closed_at })
  throw new BeamError('quiz_not_started', 409)
}

export const deadlineFor = (startedAt: number, limit: number, extra: number) => startedAt + (limit + extra) * MINUTE
