// Saved dry runs are replaceable operational snapshots, never assessment evidence.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import type { Input } from './input'
import { all, commit, insist, one, sha256Hex, stmt } from './core'
import { erasureOwner } from './erasure-policy'
import { preparedCheckpoint } from './erasure-fence'
import { erasurePreview } from './erasure'

export async function ruleSnapshots(env: Bindings, member: string) {
  const rows = await all<{ id: string; name: string; preview_json: string; state: string }>(env, `SELECT id,name,preview_json,state FROM beam_automation_rules WHERE EXISTS(
    SELECT 1 FROM json_tree(preview_json) j WHERE j.atom IN (
      SELECT ?1 UNION SELECT id FROM beam_assignments WHERE learner_id=?1
      UNION SELECT id FROM beam_completions WHERE learner_id=?1
      UNION SELECT email FROM beam_members WHERE id=?1
    )) ORDER BY id LIMIT 40`, member)
  return Promise.all(rows.map(async row => ({ id: row.id, name: row.name, state: row.state,
    digest: await sha256Hex(new TextEncoder().encode(row.preview_json)) })))
}

/** A separate, explicit owner decision withdraws complete shared previews and pauses their rules. */
export async function withdrawRuleSnapshots(env: Bindings, actor: Actor, input: Input) {
  erasureOwner(actor)
  insist(input.text('kind') === 'person', 'person_erasure_required')
  const preview = await erasurePreview(env, actor, input)
  insist(input.flag('consent'), 'snapshot_withdrawal_consent_required', 409)
  insist(input.text('digest') === preview.digest, 'stale_erasure_preview', 409)
  insist(input.text('justification', { max: 2000 }), 'snapshot_withdrawal_reason_required')
  const snapshots = preview.inventory.ruleSnapshots
  insist(snapshots.length, 'no_rule_snapshots', 409)
  insist(!await one(env, "SELECT 1 FROM beam_erasure_jobs WHERE kind='person' AND subject_id=? AND state!='complete'", preview.subject), 'erasure_in_progress', 409)
  // D1 batches are atomic: an intervening edit to any preview refuses the entire decision.
  const statements = []
  for (const snapshot of snapshots) {
    const row = await one<{ preview_json: string; state: string }>(env, 'SELECT preview_json,state FROM beam_automation_rules WHERE id=?', snapshot.id)
    insist(row && await sha256Hex(new TextEncoder().encode(row.preview_json)) === snapshot.digest && row.state === snapshot.state, 'stale_erasure_preview', 409)
    statements.push(stmt(env, "UPDATE beam_automation_rules SET state='paused',preview_json=NULL,previewed_at=NULL WHERE id=? AND preview_json=? AND state=?", snapshot.id, row.preview_json, row.state),
      stmt(env, 'INSERT INTO beam_erasure_guard SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'))
  }
  statements.push(...await preparedCheckpoint(env), stmt(env, 'DELETE FROM beam_erasure_guard'))
  await commit(env, statements, { actor, action: 'erasure.snapshots.withdraw', subject: preview.subject,
    detail: { rules: snapshots.map(({ id, digest }) => ({ id, digest })) } })
  return { kind: 'person', subject: preview.subject, withdrawn: snapshots.length }
}
