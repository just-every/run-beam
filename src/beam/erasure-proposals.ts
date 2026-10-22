// Whole pending/declined preparations can be withdrawn without undoing a learning decision.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import type { Input } from './input'
import { all, commit, insist, now, one, sha256Hex, stmt, type Row } from './core'
import { erasureOwner } from './erasure-policy'
import { erasurePreview } from './erasure'
import { preparedCheckpoint } from './erasure-fence'

const fields = ['title','agent','inputs_json','reasons_json','excluded_json','payload_json','payload_sha256','result_json','state','decided_by','decided_at','decision_note'] as const
const independent = "NOT EXISTS(SELECT 1 FROM beam_outcome_plans WHERE intervention=p.id) AND NOT EXISTS(SELECT 1 FROM beam_outcome_evaluations WHERE intervention=p.id)"
async function affected(env: Bindings, member: string) {
  const selectors = `SELECT ?1 UNION SELECT email FROM beam_members WHERE id=?1
    UNION SELECT employee_id FROM beam_members WHERE id=?1 UNION SELECT username FROM beam_members WHERE id=?1
    UNION SELECT id FROM beam_assignments WHERE learner_id=?1
    UNION SELECT id FROM beam_attempts WHERE assignment_id IN (SELECT id FROM beam_assignments WHERE learner_id=?1)
    UNION SELECT id FROM beam_completions WHERE learner_id=?1
    UNION SELECT c.id FROM beam_certificates c JOIN beam_completions x ON x.id=c.completion_id WHERE x.learner_id=?1
    UNION SELECT id FROM beam_imported_history WHERE json_extract(payload,'$.member')=?1 OR lower(json_extract(payload,'$.email'))=(SELECT lower(email) FROM beam_members WHERE id=?1)`
  const contains = ['inputs_json','reasons_json','excluded_json','payload_json','result_json'].map(field => `EXISTS(SELECT 1 FROM json_tree(p.${field}) j WHERE j.atom IN (${selectors}))`).join(' OR ')
  return all<Row>(env, `SELECT p.* FROM beam_agent_proposals p WHERE p.withdrawn_at IS NULL AND p.state IN ('waiting','declined') AND ${independent} AND (${contains}) ORDER BY p.id LIMIT 40`, member)
}
const fingerprint = (row: Row) => sha256Hex(new TextEncoder().encode(JSON.stringify(fields.map(field => row[field]))))
export async function proposalSnapshots(env: Bindings, member: string) {
  return Promise.all((await affected(env, member)).map(async row => ({ id: row.id as string, kind: row.kind as string, title: row.title as string, state: row.state as string, digest: await fingerprint(row) })))
}
export async function withdrawProposalSnapshots(env: Bindings, actor: Actor, input: Input) {
  erasureOwner(actor)
  insist(input.text('kind') === 'person', 'person_erasure_required')
  const preview = await erasurePreview(env, actor, input)
  insist(input.flag('consent'), 'snapshot_withdrawal_consent_required', 409)
  insist(input.text('digest') === preview.digest, 'stale_erasure_preview', 409)
  insist(input.text('justification', { max: 2000 }), 'snapshot_withdrawal_reason_required')
  insist(!await one(env, "SELECT 1 FROM beam_erasure_jobs WHERE kind='person' AND subject_id=? AND state!='complete'", preview.subject), 'erasure_in_progress', 409)
  const rows = await affected(env, preview.subject), snapshots = preview.inventory.proposalSnapshots
  insist(rows.length && rows.length === snapshots.length, 'stale_erasure_preview', 409)
  const statements = []
  for (const [index, row] of rows.entries()) {
    insist(row.id === snapshots[index].id && await fingerprint(row) === snapshots[index].digest, 'stale_erasure_preview', 409)
    statements.push(stmt(env, `UPDATE beam_agent_proposals AS p SET title='Withdrawn preparation',agent=NULL,inputs_json='[]',reasons_json='[]',excluded_json='[]',payload_json='{}',payload_sha256='withdrawn',decision_note=NULL,result_json=NULL,withdrawn_at=?,withdrawn_by=?
      WHERE p.id=? AND p.withdrawn_at IS NULL AND ${fields.map(field => `p.${field} IS ?`).join(' AND ')} AND ${independent}`, now(), actor.id, row.id, ...fields.map(field => row[field])),
      stmt(env, 'INSERT INTO beam_erasure_guard SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'))
  }
  statements.push(...await preparedCheckpoint(env), stmt(env, 'DELETE FROM beam_erasure_guard'))
  await commit(env, statements, { actor, action: 'erasure.proposals.withdraw', subject: preview.subject,
    detail: { proposals: rows.map(row => ({ id: row.id, kind: row.kind, decision: row.state })) } })
  return { kind: 'person', subject: preview.subject, withdrawn: rows.length }
}
