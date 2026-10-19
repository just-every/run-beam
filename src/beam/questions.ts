// Diagnose before assigning: a manager approves a question plan (purpose,
// questions, participants, closing date) before anyone is asked anything.
// Answering is optional. Answers are stored without the person or time, and
// the manager (or their agent) reads them only after the plan closes with at
// least MIN_ANSWERS answers, so nobody's answers can be singled out or ranked.
import type { Bindings } from '../auth.server'
import type { Kind } from './agent-work'
import { isManager, type Actor } from './actor'
import { BeamError, all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { requireBusiness } from './people'
import { localDate, zonedInstant } from './time'

/** Decided default: fewer answers than this are never shown, even after closing. */
export const MIN_ANSWERS = 3

const managerOnly = async (_env: Bindings, actor: Actor) => { insist(isManager(actor), 'forbidden', 403) }
const text = (value: unknown, code: string, max: number) => {
  insist(typeof value === 'string' && value.trim() && value.trim().length <= max, code)
  return (value as string).trim()
}

export const questionPlanKind: Kind = {
  label: 'Question plan',
  prepare: ['manager'],
  async validate(env, _actor, value) {
    insist(value && typeof value === 'object' && !Array.isArray(value), 'invalid_payload')
    const payload = value as Record<string, any>
    const business = await requireBusiness(env)
    insist(Array.isArray(payload.questions) && payload.questions.length >= 1 && payload.questions.length <= 10, 'invalid_questions')
    const questions = payload.questions.map((question: unknown) => text(question, 'invalid_questions', 500))
    insist(Array.isArray(payload.participants) && payload.participants.length >= 1 && payload.participants.length <= 200, 'invalid_participants')
    const participants = [...new Set(payload.participants.map((member: unknown) => text(member, 'invalid_participants', 64)))] as string[]
    for (const member of participants) insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', member), 'person_not_found', 404)
    const closesOn = text(payload.closesOn, 'invalid_closes_on', 10)
    zonedInstant(closesOn, '23:59', business.timezone)
    insist(closesOn > localDate(now(), business.timezone), 'closes_on_must_be_future')
    return { title: text(payload.title, 'invalid_title', 160), purpose: text(payload.purpose, 'invalid_purpose', 2000), questions, participants, closesOn }
  },
  mayDecide: managerOnly,
  async apply(env, actor, { id, payload }) {
    const business = await requireBusiness(env)
    insist(payload.closesOn > localDate(now(), business.timezone), 'proposal_stale', 409)
    const plan = newId()
    await commit(env, [
      stmt(env, 'INSERT INTO beam_question_plans (id, title, purpose, questions_json, closes_on, closes_at, proposal_id, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', plan, payload.title, payload.purpose, JSON.stringify(payload.questions), payload.closesOn, zonedInstant(payload.closesOn, '23:59', business.timezone), id, actor.id, now()),
      ...(payload.participants as string[]).map(member => stmt(env, "INSERT INTO beam_question_invites (plan_id, member_id, state) VALUES (?, ?, 'waiting')", plan, member)),
    ], { actor, action: 'questions.open', subject: plan, detail: { proposal: id, participants: payload.participants.length } })
    return { plan }
  },
}

async function loadPlan(env: Bindings, id: string): Promise<Row & { questions: string[]; open: boolean }> {
  const plan = await one(env, 'SELECT * FROM beam_question_plans WHERE id = ?', id)
  if (!plan) throw new BeamError('not_found', 404)
  return { ...plan, questions: JSON.parse(plan.questions_json) as string[], open: plan.closed_at === null && plan.closes_at > now() }
}

/** Plans waiting for this person's answer. */
export async function myQuestions(env: Bindings, actor: Actor) {
  return await all(env, "SELECT p.id, p.title, p.closes_on AS closesOn FROM beam_question_invites i JOIN beam_question_plans p ON p.id = i.plan_id WHERE i.member_id = ? AND i.state = 'waiting' AND p.closed_at IS NULL AND p.closes_at > ? ORDER BY p.closes_at", actor.id, now())
}

/** An invitee sees the plan and their own state; a manager sees participation and, once released, the answers. */
export async function questionPlanView(env: Bindings, actor: Actor, id: string) {
  const plan = await loadPlan(env, id)
  const invite = await one(env, 'SELECT state FROM beam_question_invites WHERE plan_id = ? AND member_id = ?', id, actor.id)
  if (!invite && !isManager(actor)) throw new BeamError('not_found', 404)
  const approver = await one(env, 'SELECT name FROM beam_members WHERE id = ?', plan.approved_by)
  const base = { id: plan.id, title: plan.title, purpose: plan.purpose, questions: plan.questions, closesOn: plan.closes_on, open: plan.open, approvedBy: approver?.name, myState: invite?.state ?? null }
  if (!isManager(actor)) return base
  const counts = Object.fromEntries((await all(env, 'SELECT state, COUNT(*) AS n FROM beam_question_invites WHERE plan_id = ? GROUP BY state', id)).map(row => [row.state, row.n]))
  const answered = counts.answered ?? 0
  const released = !plan.open && answered >= MIN_ANSWERS
  // Answer order carries no meaning: rows are returned by their random id.
  const answers = released ? (await all(env, 'SELECT answers_json FROM beam_question_answers WHERE plan_id = ? ORDER BY id', id)).map(row => JSON.parse(row.answers_json) as (string | null)[]) : null
  return { ...base, participation: { invited: answered + (counts.declined ?? 0) + (counts.waiting ?? 0), answered, declined: counts.declined ?? 0, waiting: counts.waiting ?? 0 }, answers, hidden: released ? null : plan.open ? 'still_open' : 'too_few_answers', minimumAnswers: MIN_ANSWERS }
}

async function claimInvite(env: Bindings, actor: Actor, id: string, state: 'answered' | 'declined') {
  const plan = await loadPlan(env, id)
  const invite = await one(env, 'SELECT state FROM beam_question_invites WHERE plan_id = ? AND member_id = ?', id, actor.id)
  if (!invite) throw new BeamError('not_found', 404)
  insist(plan.open, 'questions_closed', 409)
  insist(invite.state === 'waiting', 'already_responded', 409)
  return { plan, claim: stmt(env, "UPDATE beam_question_invites SET state = ? WHERE plan_id = ? AND member_id = ? AND state = 'waiting'", state, id, actor.id) }
}

export async function answerQuestions(env: Bindings, actor: Actor, input: Input) {
  const id = input.text('plan')
  const { plan, claim } = await claimInvite(env, actor, id, 'answered')
  const answers = plan.questions.map((_question, index) => input.text(`answer${index + 1}`, { max: 4000, optional: true }) || null)
  insist(answers.some(answer => answer !== null), 'answers_required')
  // The answer row and the invitation change commit together; the audit names
  // the plan, never the person who answered.
  const result = await env.DB.batch([claim, stmt(env, 'INSERT INTO beam_question_answers (id, plan_id, answers_json) SELECT ?, ?, ? WHERE changes() = 1', newId(), id, JSON.stringify(answers)), stmt(env, "INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, 'respondent', 'questions.answer', ?, '{}' WHERE changes() = 1", now(), id)])
  insist(result[0].meta.changes === 1, 'already_responded', 409)
  return { id }
}

export async function declineQuestions(env: Bindings, actor: Actor, input: Input) {
  const id = input.text('plan')
  const { claim } = await claimInvite(env, actor, id, 'declined')
  const [result] = await env.DB.batch([claim])
  insist(result.meta.changes === 1, 'already_responded', 409)
  return { id }
}

export async function closeQuestions(env: Bindings, actor: Actor, input: Input) {
  insist(isManager(actor), 'forbidden', 403)
  const plan = await loadPlan(env, input.text('plan'))
  insist(plan.open, 'questions_closed', 409)
  await commit(env, [stmt(env, 'UPDATE beam_question_plans SET closed_at = ? WHERE id = ? AND closed_at IS NULL', now(), plan.id)], { actor, action: 'questions.close', subject: plan.id })
  return { id: plan.id }
}
