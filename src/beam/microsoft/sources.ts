import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all, commit, insist, newId, now, one, stmt } from '../core'
import { Input } from '../input'
import { store } from '../files'
import { addSourceVersion } from '../sources'
import { microsoftOwner, activeConnection } from './account'
import { graphJson, graphToken, segment } from './graph'
import { itemRights, snapshot, snapshotPreview } from './snapshot'

export async function browseMicrosoft(env: Bindings, actor: Actor, input: Input) {
  microsoftOwner(actor); const connection = await activeConnection(env), token = await graphToken(env)
  const parent = input.text('parent', { optional: true, max: 300 })
  const result = await graphJson(token, `/drives/${segment(connection.drive_id)}/${parent ? `items/${segment(parent)}` : 'root'}/children?$top=100`)
  insist(Array.isArray(result.value), 'microsoft_listing_invalid', 502)
  return { items: result.value.map((item: any) => ({ id: item.id, name: item.name, folder: !!item.folder, size: item.size })), complete: !result['@odata.nextLink'] }
}
export async function previewMicrosoft(env: Bindings, actor: Actor, input: Input) {
  microsoftOwner(actor); return snapshotPreview(env, input.text('item', { max: 300 }))
}
export async function importMicrosoft(env: Bindings, actor: Actor, input: Input) {
  microsoftOwner(actor); insist(input.flag('reviewed'), 'microsoft_snapshot_review_required', 409)
  const state = await snapshot(env, input.text('item', { max: 300 }))
  insist(state.metadata.eTag === input.text('etag', { max: 500 }) && state.sha256 === input.text('sha256', { max: 64 }) && state.connection.version === input.integer('connectionVersion'), 'microsoft_preview_stale', 409)
  const permissions = JSON.stringify(state.permissions)
  insist(JSON.stringify(input.json('permissions')) === permissions, 'microsoft_preview_stale', 409)
  const licence = input.text('licence'), evidence = input.text('licenceEvidence', { max: 2000 }), reviewer = input.text('reviewer')
  insist(['owned', 'licensed', 'permission'].includes(licence), 'invalid_licence')
  insist(await one(env, 'SELECT 1 FROM beam_members WHERE id=?', reviewer), 'reviewer_not_found', 404)
  const id = newId(), version = newId(), at = now(), stored = await store(env, { filename: state.metadata.name, bytes: state.bytes })
  const provenance = JSON.stringify({ provider: 'microsoft', tenant: state.connection.tenant_id, site: state.connection.site_id, library: state.connection.drive_id, item: state.metadata.id, etag: state.metadata.eTag, permissions: state.permissions })
  await commit(env, [
    stmt(env, 'INSERT INTO beam_sources(id,title,licence,licence_evidence,reviewer_id,created_by,created_at) VALUES(?,?,?,?,?,?,?)', id, input.text('title', { max: 160 }), licence, evidence, reviewer, actor.id, at),
    stmt(env, 'INSERT INTO beam_source_versions(id,source_id,number,filename,media_type,size,sha256,provenance,uploaded_by,uploaded_at) VALUES(?,?,1,?,?,?,?,?,?,?)', version, id, stored.filename, stored.mediaType, stored.size, stored.sha256, provenance, actor.id, at),
    stmt(env, "INSERT INTO beam_microsoft_sources VALUES(?,?,?,?,?,'available',?)", id, state.metadata.id, state.connection.version, state.metadata.eTag, permissions, at),
  ], { actor, action: 'microsoft.import', subject: id, detail: { site: state.connection.site_id, library: state.connection.drive_id, item: state.metadata.id, reviewed: true, sha256: stored.sha256 } })
  return { id, versionId: version }
}
export async function syncMicrosoft(env: Bindings, actor: Actor, input: Input) {
  microsoftOwner(actor)
  const source = input.text('source'), linked = await one(env, "SELECT * FROM beam_microsoft_sources WHERE source_id=? AND state='available'", source)
  insist(linked, 'microsoft_source_rights_revoked', 409)
  try {
    const rights = await itemRights(env, linked.item_id)
    insist(rights.connection.version === linked.connection_version && JSON.stringify(rights.permissions) === linked.permissions_json, 'microsoft_source_rights_revoked', 409)
    if (rights.metadata.eTag === linked.etag) return { changed: false, source }
    const state = await snapshot(env, linked.item_id)
    const provenance = JSON.stringify({ provider: 'microsoft', tenant: state.connection.tenant_id, site: state.connection.site_id, library: state.connection.drive_id, item: state.metadata.id, etag: state.metadata.eTag, permissions: state.permissions })
    const result = await addSourceVersion(env, actor, Input.of({ source, provenance, file: { filename: state.metadata.name, base64: btoa(Array.from(state.bytes, byte => String.fromCharCode(byte)).join('')) } }), true)
    await commit(env, [stmt(env, 'UPDATE beam_microsoft_sources SET etag=?,checked_at=? WHERE source_id=?', state.metadata.eTag, now(), source)], { actor, action: 'microsoft.sync', subject: source, detail: { version: result.id } })
    return { changed: true, source, versionId: result.id, affectedCourses: result.flaggedCourses }
  } catch (error) {
    await commit(env, [stmt(env, "UPDATE beam_microsoft_sources SET state='revoked',checked_at=? WHERE source_id=?", now(), source)], { actor, action: 'microsoft.rights_revoked', subject: source })
    throw error
  }
}
export async function microsoftSourceStatus(env: Bindings, actor: Actor) {
  microsoftOwner(actor)
  return all(env, `SELECT m.source_id AS source,m.state,m.etag,m.checked_at AS checkedAt,s.title,
   (SELECT json_group_array(DISTINCT l.course_revision_id) FROM beam_lesson_revisions l JOIN json_each(l.source_version_ids) j JOIN beam_source_versions v ON v.id=j.value WHERE v.source_id=m.source_id) AS affectedRevisions
   FROM beam_microsoft_sources m JOIN beam_sources s ON s.id=m.source_id ORDER BY s.title`)
}
