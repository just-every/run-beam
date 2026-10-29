import type { Bindings } from '../../auth.server'
import { all, BeamError, commit, insist, now, one, stmt } from '../core'
import { itemRights } from './snapshot'

export async function assertMicrosoftSources(env: Bindings, references: unknown) {
  function expand(value: any): any {
    if (typeof value === 'string' && /^[\[{]/.test(value)) { try { return expand(JSON.parse(value)) } catch { return value } }
    if (Array.isArray(value)) return value.map(expand)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,expand(item)]))
    return value
  }
  const encoded = JSON.stringify(expand(references ?? null))
  const rows = await all(env, `SELECT DISTINCT m.* FROM beam_microsoft_sources m JOIN beam_source_versions v ON v.source_id=m.source_id
    JOIN json_tree(?) j ON j.atom=v.id OR j.atom=m.source_id`, encoded)
  for (const row of rows) {
    insist(row.state === 'available', 'microsoft_source_rights_revoked', 409)
    try {
      const state = await itemRights(env, row.item_id)
      insist(state.connection.version === row.connection_version && JSON.stringify(state.permissions) === row.permissions_json, 'microsoft_source_rights_revoked', 409)
    } catch (error) {
      await commit(env, [stmt(env, "UPDATE beam_microsoft_sources SET state='revoked',checked_at=? WHERE source_id=?", now(), row.source_id)],
        { actor: 'microsoft', action: 'microsoft.rights_revoked', subject: row.source_id })
      if (error instanceof BeamError) throw new BeamError('microsoft_source_rights_revoked', 409)
      throw error
    }
  }
}
export async function assertMicrosoftFile(env: Bindings, sha256: string) {
  const versions = await all(env, 'SELECT v.id FROM beam_source_versions v JOIN beam_microsoft_sources m ON m.source_id=v.source_id WHERE v.sha256=?', sha256)
  if (versions.length) await assertMicrosoftSources(env, versions)
}
export async function assertMicrosoftDistribution(env: Bindings) {
  // Whole-estate exports carry frozen text as well as files. Fail closed before creating one.
  await assertMicrosoftSources(env, await all(env, 'SELECT source_id FROM beam_microsoft_sources'))
}

export async function assertMicrosoftRevision(env: Bindings, revision: string) {
  await assertMicrosoftSources(env, await all(env, 'SELECT source_version_ids,blocks_json FROM beam_lesson_revisions WHERE course_revision_id=?', revision))
}
