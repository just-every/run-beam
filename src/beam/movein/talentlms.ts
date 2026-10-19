// Imported history remains native, labelled evidence. Review is a separate action.
import type { Bindings } from '../../auth.server'
import { canonicalJson } from '../../modules/import-kit/src/d1/index'
import { requireRole, type Actor } from '../actor'
import { all, commit, insist, newId, now, one, stmt } from '../core'
import type { Input } from '../input'
import { inScope, requireLearnerScope } from '../scope'

export async function importedHistory(env: Bindings, actor: Actor) {
  requireRole(actor, 'manager')
  // A manager reads and reviews imported completions of their teams' people (ORG-004).
  return (await all(env, 'SELECT id, kind, payload, revision FROM beam_imported_history ORDER BY kind, id')).map(row => ({ id: row.id, kind: row.kind, revision: row.revision, ...JSON.parse(row.payload) }))
    .filter(row => row.kind !== 'completion' || !row.member || inScope(actor, row.member))
}

/** A later decision on imported evidence: a manager records that it was reviewed. Undo keeps such rows. */
export async function acceptHistory(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'manager')
  const row = await one(env, "SELECT * FROM beam_imported_history WHERE id = ? AND kind = 'completion'", input.text('history', { max: 100 }))
  insist(row, 'history_not_found', 404)
  const payload = JSON.parse(row.payload)
  if (payload.member) requireLearnerScope(actor, payload.member)
  insist(!payload.accepted, 'history_already_accepted', 409)
  payload.accepted = { by: actor.id, at: now(), note: input.text('note', { max: 1000 }) }
  const revision = newId()
  await commit(env, [stmt(env, 'UPDATE beam_imported_history SET payload = ?, revision = ? WHERE id = ? AND revision = ?', canonicalJson(payload), revision, row.id, row.revision)], { actor, action: 'history.accept', subject: row.id, detail: payload.accepted })
  return { id: row.id, revision }
}
