import { assertMicrosoftDistribution } from './microsoft/rights'
// OPS-002: independent JSON interchange, not a database backup or a credential export.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, insist, sha256Hex, type Row } from './core'
import { serve } from './files'
import { certificatePdfResponse } from './certificates'
import { acknowledgmentEvidence } from './acknowledgments'

// Deliberate learning inventory: never discover auth/provider/grant tables by prefix.
import { LEARNING_INVENTORY } from './data-export-inventory'
const encoder = new TextEncoder()
const digest = (value: unknown) => sha256Hex(encoder.encode(JSON.stringify(value)))
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'" }

/** One D1 batch reads the records in a transaction. Files retain their content-addressed ids. */
export async function dataExport(env: Bindings, actor: Actor) {
  requireOwner(actor)
  await assertMicrosoftDistribution(env)
  const results = await env.DB.batch(Object.entries(LEARNING_INVENTORY).map(([table, columns]) => env.DB.prepare(`SELECT ${columns} FROM ${table} ORDER BY rowid`)))
  const records: Record<string, { count: number; sha256: string; rows: Row[] }> = {}
  for (let i = 0; i < Object.keys(LEARNING_INVENTORY).length; i++) {
    const rows = results[i].results as Row[]
    records[Object.keys(LEARNING_INVENTORY)[i]] = { count: rows.length, sha256: await digest(rows), rows }
  }
  const sources = records.beam_sources.rows
  const files = [...records.beam_source_versions.rows.filter(row => !sources.find(source => source.id === row.source_id)?.erased_at).map(row => ({ ...row, source: sources.find(source => source.id === row.source_id) })), ...records.beam_attachments.rows]
    .map((row: Row) => ({ id: row.id, sha256: row.sha256, size: row.size, filename: row.filename, mediaType: row.media_type,
      href: `/app/data-export/files/${row.sha256}`, licence: row.source?.licence ?? 'employer evidence', licenceEvidence: row.source?.licence_evidence ?? null }))
  const xapiFiles = records.beam_xapi_attachments.rows.map(row => ({
    id: `${row.statement_id}:${row.sha256}`, kind: 'xapi_attachment', statementId: row.statement_id,
    filename: row.filename, mediaType: row.media_type, sha256: row.sha256, size: row.size,
    href: `/app/data-export/files/${row.sha256}`, licence: 'employer evidence', licenceEvidence: null,
  }))
  files.push(...xapiFiles)
  const exclusions: Row[] = []
  for (const item of records.beam_packages.rows) {
    const rights = { packageId: item.id, licence: item.licence, licenceEvidence: item.licence_evidence }
    const packageFiles = [
      { id: item.id, kind: 'package_zip', filename: item.original_filename, mediaType: 'application/zip', sha256: item.original_sha256, size: item.original_size },
      ...records.beam_package_assets.rows.filter(asset => asset.package_id === item.id).map(asset => ({
        id: `${item.id}:${asset.path}`, kind: 'package_asset', path: asset.path, filename: asset.path,
        mediaType: asset.media_type, sha256: asset.sha256, size: asset.size,
      })),
    ].map(file => ({ ...file, ...rights, href: `/app/data-export/files/${file.sha256}` }))
    for (const file of packageFiles) {
      if (item.export_restriction) exclusions.push({ ...file, reason: item.export_restriction, retrievalHref: file.href, retrievalAuthorization: 'Current signed-in owner session; recorded licence obligations apply.' })
      else files.push(file)
    }
  }
  const derived = async (id: string, href: string, response: Response) => {
    const bytes = new Uint8Array(await response.arrayBuffer())
    return { id, href, size: bytes.length, sha256: await sha256Hex(bytes) }
  }
  const certificates = []
  for (const row of records.beam_certificates.rows) certificates.push(await derived(row.id, `/app/certificates/${row.id}.pdf`, await certificatePdfResponse(env, actor, row.id)))
  const signatures = []
  for (const row of records.beam_acknowledgments.rows.filter(row => row.state !== 'open')) signatures.push(await derived(row.id, `/app/acknowledgments/${row.id}/evidence`, await acknowledgmentEvidence(env, actor, row.id)))
  const manifest = { format: 'beam.learning-export.v1', exportedAt: new Date().toISOString(), records, files, certificates, signatures,
    exclusions,
    scope: 'Current native learning, SCORM package metadata, revision links, runtime state and raw events, xAPI activity metadata, launches with pseudonymous registrations, original statements and attachments, approved external-tool result lineage, external certificates and labelled imported history. Package ZIPs and assets retain their recorded rights; explicit package export restrictions enumerate every excluded file with its reason and authorized owner retrieval path.',
    credentials: 'Authentication, playback sessions, xAPI authentication session IDs, LRS connections and sealed producer credentials, application/preparation credentials, public sharing tokens, provider configuration and model credentials are not part of this format.',
    documentation: 'https://github.com/just-every/run-beam/blob/main/docs/data-export.md',
  }
  return new Response(JSON.stringify(manifest), { headers: { ...headers, 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="beam-learning-export.json"' } })
}

/** Only inventory files may be downloaded; the owner's live session is required again on each request. */
export async function dataExportFile(env: Bindings, actor: Actor, sha256: string) {
  requireOwner(actor)
  insist(/^[a-f0-9]{64}$/.test(sha256), 'not_found', 404)
  const rows = await all(env, `SELECT v.filename, v.media_type AS mediaType, v.size, v.sha256 FROM beam_source_versions v JOIN beam_sources s ON s.id=v.source_id WHERE v.sha256 = ? AND s.erased_at IS NULL
    UNION ALL SELECT filename, media_type AS mediaType, size, sha256 FROM beam_attachments WHERE sha256 = ?
    UNION ALL SELECT original_filename AS filename, 'application/zip' AS mediaType, original_size AS size, original_sha256 AS sha256 FROM beam_packages WHERE original_sha256 = ?
    UNION ALL SELECT path AS filename, media_type AS mediaType, size, sha256 FROM beam_package_assets WHERE sha256 = ?
    UNION ALL SELECT filename, media_type AS mediaType, size, sha256 FROM beam_xapi_attachments WHERE sha256 = ?`, sha256, sha256, sha256, sha256, sha256)
  insist(rows.length, 'not_found', 404)
  return serve(env, rows[0] as { filename: string; mediaType: string; size: number; sha256: string }, { download: true })
}
