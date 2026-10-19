// LEARN-018: time-limited assessments. A timed quiz attempt starts on the
// server and its clock keeps running whether or not the learner is on the page.
// Answers are saved into the attempt until its deadline; at expiry the server
// closes it and scores only what was saved, and any later answer is refused
// through every door. A recorded accommodation (LEARN-011), granted by the owner
// or by a manager for people in one of their teams, adds minutes or a
// percentage, per course or for all assessments, and is stored on the attempt.
import type { Bindings } from '../auth.server'
import { requireRole, type Actor } from './actor'
import type { Question } from './courses'
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
  return new Map((await all<{ question_id: string; answer_json: string }>(env, 'SELECT question_id, answer_json FROM beam_quiz_session_answers WHERE session_id = ?', sessionId)).map(row => [row.question_id, JSON.parse(row.answer_json) as number[]]))
}

/** The learner's selection for each question named in the input, checked against its choices. */
export function selectionsFrom(questions: Question[], input: Input, { onlyPresent = false } = {}) {
  const selections = new Map<string, number[]>()
  for (const question of questions) {
    if (onlyPresent && !input.has(`q_${question.id}`)) continue
    const selected = [...new Set(input.list(`q_${question.id}`).map(Number))].sort((a, b) => a - b)
    insist(selected.every(index => Number.isInteger(index) && index >= 0 && index < question.choices.length), 'invalid_answer')
    selections.set(question.id, selected)
  }
  return selections
}

/** Exact-set scoring: a question scores one point only when the selected choices equal the correct choices; an unanswered question scores none. */
export function score(questions: Question[], selections: Map<string, number[]>) {
  return questions.map(question => {
    const selected = selections.get(question.id) ?? []
    return { question: question.id, selected, correct: selected.length === question.correct.length && selected.every((value, index) => value === question.correct[index]) }
  })
}

export function upsertAnswers(env: Bindings, sessionId: string, selections: Map<string, number[]>, at: number) {
  return [...selections].map(([question, selected]) => stmt(env, 'INSERT INTO beam_quiz_session_answers (session_id, question_id, answer_json, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT (session_id, question_id) DO UPDATE SET answer_json = excluded.answer_json, saved_at = excluded.saved_at', sessionId, question, JSON.stringify(selected), at))
}

/** Closes an open session at `at` (its deadline when it expired) and writes its scored attempt from the saved answers. */
export async function closeSession(env: Bindings, session: Row, questions: Question[], passPercent: number, attemptsLeft: number, reason: 'submitted' | 'expired', at: number, actor: string) {
  const responses = score(questions, await savedAnswers(env, session.id))
  const points = responses.filter(response => response.correct).length
  const percent = Math.floor(points * 100 / responses.length)
  const passed = percent >= passPercent
  const recorded = await one<{ n: number }>(env, "SELECT COUNT(*) AS n FROM beam_attempts WHERE assignment_id = ? AND kind = 'quiz'", session.assignment_id)
  const number = (recorded?.n ?? 0) + 1
  const left = attemptsLeft - 1
  const decision = passed ? 'passed' : left > 0 ? `retry allowed: ${left} attempt${left === 1 ? '' : 's'} remaining` : 'no attempts remaining: a manager may grant another attempt'
  const id = newId()
  const rule = `exact choice match per question; pass at ${passPercent}%; time limit ${session.time_limit_minutes} minutes${session.extra_minutes ? ` plus ${session.extra_minutes} minutes extra time` : ''}; only answers saved before the limit count`
  // The attempt is written first, only while the session is open; a concurrent closer's attempt number collides and loses.
  const statements = [
    stmt(env, `INSERT INTO beam_attempts (id, assignment_id, assessment_revision_id, kind, number, submitted_at, score, max_score, passed, scoring_rule, retry_decision, state, started_at, closed_at, close_reason, time_limit_minutes, extra_minutes, accommodation_json)
      SELECT ?, ?, ?, 'quiz', ?, ?, ?, ?, ?, ?, ?, 'scored', ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM beam_quiz_sessions WHERE id = ? AND closed_at IS NULL)`,
      id, session.assignment_id, session.assessment_revision_id, number, at, points, responses.length, passed ? 1 : 0, rule, decision, session.started_at, at, reason, session.time_limit_minutes, session.extra_minutes, session.accommodation_json, session.id),
    stmt(env, 'UPDATE beam_quiz_sessions SET closed_at = ?, close_reason = ?, attempt_id = ? WHERE id = ? AND closed_at IS NULL AND EXISTS (SELECT 1 FROM beam_attempts WHERE id = ?)', at, reason, id, session.id, id),
    ...responses.map(response => stmt(env, 'INSERT INTO beam_responses (attempt_id, question_id, answer_json, correct) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM beam_attempts WHERE id = ?)', id, response.question, JSON.stringify(response.selected), response.correct ? 1 : 0, id)),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM beam_attempts WHERE id = ?)', now(), actor, reason === 'expired' ? 'quiz.expire' : 'quiz.attempt', id, JSON.stringify({ assignment: session.assignment_id, session: session.id, points, of: responses.length, passed, closedAt: at }), id),
  ]
  const claimed = await env.DB.batch(statements).catch(async error => {
    if (await one(env, 'SELECT 1 FROM beam_quiz_sessions WHERE id = ? AND closed_at IS NOT NULL', session.id)) return null
    throw error
  })
  if (!claimed || claimed[0].meta.changes !== 1) return null
  return { id, number, score: points, maxScore: responses.length, percent, passed, retryDecision: decision }
}

/** A timed answer or submission after the deadline: refused, naming when the attempt closed. */
export async function refuseLate(env: Bindings, assignmentId: string): Promise<never> {
  const latest = await one(env, 'SELECT close_reason, closed_at FROM beam_quiz_sessions WHERE assignment_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1', assignmentId)
  if (latest?.close_reason === 'expired') throw new BeamError('time_expired', 409, { closedAt: latest.closed_at })
  throw new BeamError('quiz_not_started', 409)
}

export const deadlineFor = (startedAt: number, limit: number, extra: number) => startedAt + (limit + extra) * MINUTE
