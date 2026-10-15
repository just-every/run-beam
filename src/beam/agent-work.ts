// Work prepared for a person's approval: by the owner's own agent through a
// preparation credential, or drafted by a person through the JSON door. Each
// proposal keeps its inputs, reasons, exclusions and exact payload (with its
// SHA-256). Only a human decision applies it; the decision, its note and the
// result are recorded on the proposal and in the audit trail.
import type { Bindings } from '../auth.server'
import { requireRole, type Actor, type Role } from './actor'
import { BeamError, all, commit, insist, newId, now, one, sha256Hex, stmt } from './core'
import type { Input } from './input'
import { memberNames } from './people'
import { assignmentPlan, processChange, reminderDrafts } from './plans'
import { scenarioKind } from './practice'
import { questionPlanKind } from './questions'

export interface Kind {
  label: string
  /** Roles that may prepare this kind (the agent acts with its human's current roles). */
  prepare: Role[]
  /** Normalises and checks the payload; refuses anything that could not be applied. */
  validate(env: Bindings, actor: Actor, payload: unknown): Promise<unknown>
  /** Refuses a person who may not decide this proposal. */
  mayDecide(env: Bindings, actor: Actor, payload: any): Promise<void>
  /** Applies an approved payload; refuses with 409 when its inputs changed since preparation. */
  apply(env: Bindings, actor: Actor, proposal: { id: string; payload: any }): Promise<unknown>
}

export const KINDS: Record<string, Kind> = {
  assignment_plan: assignmentPlan,
  reminders: reminderDrafts,
  scenario: scenarioKind,
  question_plan: questionPlanKind,
  process_change: processChange,
}

const INPUTS: Record<string, { sql: string; label: (row: any) => string }> = {
  source_version: { sql: 'SELECT s.title, v.number FROM beam_source_versions v JOIN beam_sources s ON s.id = v.source_id WHERE v.id = ?', label: row => `${row.title} v${row.number}` },
  course_revision: { sql: 'SELECT title, number FROM beam_course_revisions WHERE id = ?', label: row => `${row.title} revision ${row.number}` },
  path_revision: { sql: 'SELECT p.name, r.number FROM beam_path_revisions r JOIN beam_paths p ON p.id = r.path_id WHERE r.id = ?', label: row => `${row.name} path revision ${row.number}` },
  assignment: { sql: 'SELECT c.title, m.name FROM beam_assignments a JOIN beam_courses c ON c.id = a.course_id JOIN beam_members m ON m.id = a.learner_id WHERE a.id = ?', label: row => `${row.name}'s ${row.title} assignment` },
  question_plan: { sql: 'SELECT title FROM beam_question_plans WHERE id = ?', label: row => `Question plan “${row.title}”` },
}

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const digest = async (payload: unknown) => sha256Hex(new TextEncoder().encode(canonical(payload)))

function texts(value: unknown, name: string, { max = 300, limit = 20 } = {}): string[] {
  const list = value ?? []
  insist(Array.isArray(list) && list.length <= limit && list.every(item => typeof item === 'string' && item.trim() && item.trim().length <= max), `invalid_${name}`)
  return (list as string[]).map(item => item.trim())
}

export async function propose(env: Bindings, actor: Actor, input: Input) {
  const kind = KINDS[input.text('kind', { max: 40 })]
  insist(kind, 'invalid_kind')
  requireRole(actor, ...kind.prepare)
  const title = input.text('title', { max: 160 })
  const agent = input.text('agent', { max: 120, optional: true }) || null
  const reasons = texts(input.json('reasons'), 'reasons')
  insist(reasons.length > 0, 'reasons_required')
  const excludedValue = input.json('excluded') ?? []
  insist(Array.isArray(excludedValue) && excludedValue.length <= 50, 'invalid_excluded')
  const excluded = excludedValue.map(item => {
    insist(item && typeof item.item === 'string' && typeof item.reason === 'string' && item.item.trim() && item.reason.trim() && item.item.length <= 200 && item.reason.length <= 300, 'invalid_excluded')
    return { item: item.item.trim(), reason: item.reason.trim() }
  })
  const inputsValue = input.json('inputs') ?? []
  insist(Array.isArray(inputsValue) && inputsValue.length <= 30, 'invalid_inputs')
  const inputs = []
  for (const item of inputsValue) {
    const rule = INPUTS[item?.type]
    insist(rule && typeof item.id === 'string', 'invalid_inputs')
    const row = await one(env, rule.sql, item.id)
    insist(row, 'input_not_found', 404, { type: item.type, id: item.id })
    inputs.push({ type: item.type, id: item.id, label: rule.label(row) })
  }
  const payload = await kind.validate(env, actor, input.json('payload'))
  const id = newId(), sha256 = await digest(payload)
  await commit(env, [stmt(env, "INSERT INTO beam_agent_proposals (id, kind, title, agent, prepared_by, via_agent, inputs_json, reasons_json, excluded_json, payload_json, payload_sha256, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)",
    id, input.text('kind'), title, agent, actor.id, actor.agent ? 1 : 0, JSON.stringify(inputs), JSON.stringify(reasons), JSON.stringify(excluded), JSON.stringify(payload), sha256, now())],
  { actor: actor.id, action: 'agent.propose', subject: id, detail: { kind: input.text('kind'), agent, viaAgent: actor.agent, sha256 } })
  return { id, sha256 }
}

/** A human approves or declines the exact payload they reviewed (its SHA-256). */
export async function decide(env: Bindings, actor: Actor, input: Input) {
  insist(!actor.agent, 'human_decision_required', 403)
  const row = await one(env, 'SELECT * FROM beam_agent_proposals WHERE id = ?', input.text('proposal'))
  insist(row, 'proposal_not_found', 404)
  const kind = KINDS[row.kind]
  const payload = JSON.parse(row.payload_json)
  await kind.mayDecide(env, actor, payload)
  insist(row.state === 'waiting', 'proposal_decided', 409)
  insist(input.text('sha256', { max: 64 }) === row.payload_sha256, 'proposal_changed', 409)
  const decision = input.text('decision')
  insist(decision === 'approve' || decision === 'decline', 'invalid_decision')
  const note = input.text('note', { max: 1000, optional: true }) || null
  const state = decision === 'approve' ? 'approved' : 'declined'
  // Claim the decision first so two people cannot both apply it.
  const [claim] = await env.DB.batch([stmt(env, "UPDATE beam_agent_proposals SET state = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND state = 'waiting'", state, actor.id, now(), note, row.id)])
  insist(claim.meta.changes === 1, 'proposal_decided', 409)
  let result: unknown = null
  if (state === 'approved') {
    try { result = await kind.apply(env, actor, { id: row.id, payload }) }
    catch (error) {
      await env.DB.prepare("UPDATE beam_agent_proposals SET state = 'waiting', decided_by = NULL, decided_at = NULL, decision_note = NULL WHERE id = ?").bind(row.id).run()
      throw error
    }
  }
  await commit(env, [stmt(env, 'UPDATE beam_agent_proposals SET result_json = ? WHERE id = ?', JSON.stringify(result), row.id)], { actor: actor.id, action: `agent.${state === 'approved' ? 'approve' : 'decline'}`, subject: row.id, detail: { kind: row.kind, sha256: row.payload_sha256, note, result } })
  return { id: row.id, state, result }
}

const shape = (row: any, names: Map<string, string>) => ({
  id: row.id, kind: row.kind, label: KINDS[row.kind].label, title: row.title, agent: row.agent, viaAgent: row.via_agent === 1,
  preparedBy: row.prepared_by, preparedByName: names.get(row.prepared_by), inputs: JSON.parse(row.inputs_json), reasons: JSON.parse(row.reasons_json), excluded: JSON.parse(row.excluded_json),
  payload: JSON.parse(row.payload_json), sha256: row.payload_sha256, state: row.state, decidedBy: row.decided_by, decidedByName: row.decided_by ? names.get(row.decided_by) : null,
  decidedAt: row.decided_at, note: row.decision_note, result: row.result_json ? JSON.parse(row.result_json) : null, createdAt: row.created_at,
})

/** Proposals the person could decide or prepared, by state. */
export async function listProposals(env: Bindings, actor: Actor, state = 'waiting') {
  requireRole(actor, 'author', 'reviewer', 'manager')
  insist(['waiting', 'approved', 'declined'].includes(state), 'invalid_state')
  const names = await memberNames(env)
  const rows = await all(env, 'SELECT * FROM beam_agent_proposals WHERE state = ? ORDER BY created_at DESC LIMIT 200', state)
  const visible = []
  for (const row of rows) {
    const canDecide = !actor.agent && await KINDS[row.kind].mayDecide(env, actor, JSON.parse(row.payload_json)).then(() => true, () => false)
    if (canDecide || row.prepared_by === actor.id) visible.push({ ...shape(row, names), canDecide })
  }
  return visible
}

export async function proposalDetail(env: Bindings, actor: Actor, id: string) {
  const row = await one(env, 'SELECT * FROM beam_agent_proposals WHERE id = ?', id)
  if (!row) throw new BeamError('not_found', 404)
  const mine = row.prepared_by === actor.id
  if (!mine) await KINDS[row.kind].mayDecide(env, actor, JSON.parse(row.payload_json)).catch(() => { throw new BeamError('not_found', 404) })
  return shape(row, await memberNames(env))
}
