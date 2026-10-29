import type { Bindings } from '../../auth.server'
import { insist, sha256Hex } from '../core'
import { sniff } from '../files'
import { extractDocument } from '../source-document'
import { activeConnection } from './account'
import { graphContent, graphJson, graphToken, segment } from './graph'

export const itemPath = (connection: Record<string, any>, item: string) => `/drives/${segment(connection.drive_id)}/items/${segment(item)}`
export async function itemRights(env: Bindings, item: string) {
  const connection = await activeConnection(env), token = await graphToken(env), path = itemPath(connection, item)
  const metadata = await graphJson(token, path), permissions = await graphJson(token, path + '/permissions')
  insist(metadata.id === item && metadata.parentReference?.driveId === connection.drive_id && metadata.parentReference?.siteId === connection.site_id && !metadata.deleted, 'microsoft_boundary_refused', 409)
  insist(metadata.file && typeof metadata.name === 'string' && /^[^/\\\x00-\x1f]{1,200}$/.test(metadata.name) && typeof metadata.eTag === 'string' && metadata.eTag.length <= 500 && Number.isSafeInteger(metadata.size) && metadata.size > 0 && metadata.size <= 25_000_000, 'microsoft_item_unsupported', 422)
  insist(Array.isArray(permissions.value) && permissions.value.length > 0 && !permissions['@odata.nextLink'], 'microsoft_permissions_unproven', 409)
  const rights = permissions.value.map((permission: any) => {
    insist(typeof permission.id === 'string' && Array.isArray(permission.roles) && permission.roles.some((role: string) => ['read', 'write', 'owner'].includes(role)), 'microsoft_permissions_unproven', 409)
    return { id: permission.id, roles: [...permission.roles].sort(), inheritedFrom: permission.inheritedFrom ? { driveId: permission.inheritedFrom.driveId ?? null, id: permission.inheritedFrom.id ?? null } : null }
  }).sort((a: any, b: any) => a.id.localeCompare(b.id))
  return { connection, token, path, metadata, permissions: rights }
}
export async function snapshot(env: Bindings, item: string) {
  const state = await itemRights(env, item)
  const bytes = await graphContent(state.token, state.path, state.connection.hostname)
  const after = await itemRights(env, item)
  insist(after.connection.version === state.connection.version && after.metadata.eTag === state.metadata.eTag && JSON.stringify(after.permissions) === JSON.stringify(state.permissions), 'microsoft_source_changed_during_read', 409)
  insist(bytes.length === state.metadata.size, 'microsoft_content_changed', 409)
  return { ...after, bytes, sha256: await sha256Hex(bytes) }
}
export async function snapshotPreview(env: Bindings, item: string) {
  const state = await snapshot(env, item)
  const media = sniff(state.bytes)
  const document = /^(image|audio|video)\//.test(media) ? { format: 'media', lessons: [], warnings: ['Compare the original media before importing. Add it to a reviewed course as a media block.'], uncertainties: [] } : await extractDocument(state.bytes, state.metadata.name, state.metadata.name)
  return { item, filename: state.metadata.name, etag: state.metadata.eTag, sha256: state.sha256, connectionVersion: state.connection.version,
    permissions: state.permissions, site: state.connection.site_id, drive: state.connection.drive_id,
    format: document.format, lessons: document.lessons, warnings: document.warnings, uncertainties: document.uncertainties,
    reviewRequired: true }
}
