import { xapiConnection, xapiOwner } from './xapi-catalog'
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from '../core'
import { editDraft, loadCourse } from '../courses'
import { store } from '../files'
import type { Input } from '../input'
import { requireCourseRole } from '../units'
import { parsePackage } from './manifest'
import type { PackageManifest } from './types'

export async function packageRecord(env: Bindings, id: string): Promise<Row & { manifest: PackageManifest; sources: string[] }> {
  const row = await one(env, 'SELECT * FROM beam_packages WHERE id = ?', id)
  insist(row, 'package_not_found', 404)
  return { ...row, manifest: JSON.parse(row.manifest_json) as PackageManifest, sources: JSON.parse(row.source_version_ids) as string[] }
}

export async function importPackage(env: Bindings, actor: Actor, input: Input) {
  const course = await loadCourse(env, input.text('course'))
  insist(!actor.agent && (actor.owner || actor.adminUnits.includes(course.unit_id)), 'administrator_required', 403)
  await requireCourseRole(env, actor, course.id, 'author')
  insist(input.integer('draftVersion', { min: 1 }) === course.draft_version, 'stale_draft', 409)
  const licence = input.text('licence'), evidence = input.text('licenceEvidence', { max: 4000 })
  insist(['owned', 'licensed', 'permission'].includes(licence), 'invalid_licence')
  const restriction = input.text('exportRestriction', { optional: true, max: 2000 })
  const sources = input.list('sources')
  for (const id of sources) insist(await one(env, 'SELECT 1 FROM beam_source_versions WHERE id = ?', id), 'source_version_not_found', 404)
  const file = (await input.file('file', { maxBytes: 25_000_000 }))!
  const { manifest, files } = parsePackage(file.bytes)
  let connection: string | null = null
  if (manifest.standard === 'cmi5') {
    xapiOwner(actor); insist(input.flag('consent'), 'xapi_consent_required', 422)
    connection = (await xapiConnection(env, input.text('connection'))).id
  }
  const original = await store(env, file), id = newId()
  const assets = await Promise.all(files.map(async file => ({ path: file.path, ...await store(env, { filename: file.path, bytes: file.bytes }) })))
  await commit(env, [
    stmt(env, 'INSERT INTO beam_packages(id,course_id,standard,title,manifest_json,source_version_ids,licence,licence_evidence,export_restriction,original_filename,original_sha256,original_size,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, course.id, manifest.standard, manifest.title, JSON.stringify(manifest), JSON.stringify(sources), licence, evidence, restriction || null, original.filename, original.sha256, original.size, actor.id, now()),
    ...(connection ? [stmt(env, 'INSERT INTO beam_cmi5_packages VALUES(?,?,?,?)', id, connection, actor.id, now())] : []),
    ...assets.map(asset => stmt(env, 'INSERT INTO beam_package_assets(package_id,path,sha256,size,media_type) VALUES(?,?,?,?,?)', id, asset.path, asset.sha256, asset.size, assetType(asset.path))),
  ], { actor, action: 'package.import', subject: id, detail: { course: course.id, standard: manifest.standard, licence, licenceEvidence: evidence, sources } })
  const edited = await editDraft(env, actor, input, 'package.attach', draft => { (draft.packages ??= []).push(id) })
  return { id, course: course.id, draftVersion: edited.draftVersion, manifest }
}
export async function removePackage(env: Bindings, actor: Actor, input: Input) {
  return editDraft(env, actor, input, 'package.remove', draft => { draft.packages = (draft.packages ?? []).filter(id => id !== input.text('package')) })
}
export async function revisionPackages(env: Bindings, revision: string): Promise<(Row & { manifest: PackageManifest })[]> {
  return (await all(env, 'SELECT p.* FROM beam_revision_packages r JOIN beam_packages p ON p.id=r.package_id WHERE r.course_revision_id=? ORDER BY r.position', revision)).map(row => ({ ...row, manifest: JSON.parse(row.manifest_json) as PackageManifest }))
}
export function assetType(path: string) {
  const ext = path.split('.').at(-1)?.toLowerCase() ?? ''
  const types: Record<string, string> = { html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', xml: 'application/xml', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', woff: 'font/woff', woff2: 'font/woff2', txt: 'text/plain' }
  return Object.hasOwn(types, ext) ? types[ext] : 'application/octet-stream'
}
