import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { requireOwner } from '../actor'
import { all, BeamError, commit, insist, now, one, stmt, type Row } from '../core'
import type { Input } from '../input'
import { graphJson, graphToken, microsoftUrl, segment } from './graph'

export function microsoftOwner(actor: Actor) { requireOwner(actor); insist(!actor.agent && !actor.app && !actor.viewAs, 'human_owner_required', 403) }
export const microsoftConnection = (env: Bindings) => one(env, 'SELECT * FROM beam_microsoft_connection WHERE singleton=1')
export async function activeConnection(env: Bindings) {
  const connection = await microsoftConnection(env)
  insist(connection?.enabled === 1 && connection.tenant_id === env.ENTRA_TENANT_ID, 'microsoft_connection_disabled', 409)
  return connection
}
export async function microsoftAccount(env: Bindings, actor: Actor) {
  microsoftOwner(actor)
  return { configured: !!(env.ENTRA_TENANT_ID && env.ENTRA_CLIENT_ID && env.ENTRA_CLIENT_SECRET), connection: await microsoftConnection(env),
    sources: (await all(env, `SELECT m.*,s.title,(SELECT id FROM beam_source_versions WHERE source_id=s.id ORDER BY number DESC LIMIT 1) AS latestVersion,
      (SELECT json_group_array(json_object('id',c.id,'title',c.title)) FROM beam_courses c WHERE EXISTS(SELECT 1 FROM beam_lesson_revisions l JOIN json_each(l.source_version_ids) j JOIN beam_source_versions v ON v.id=j.value WHERE l.course_revision_id=c.published_revision_id AND v.source_id=s.id)) AS courses
      FROM beam_microsoft_sources m JOIN beam_sources s ON s.id=m.source_id ORDER BY s.title`)).map(row => ({...row,courses:JSON.parse(row.courses)} as Row)) }
}
export async function configureMicrosoft(env: Bindings, actor: Actor, input: Input) {
  microsoftOwner(actor)
  const operation = input.text('operation'), current = await microsoftConnection(env)
  insist(['connect', 'revoke'].includes(operation), 'microsoft_operation')
  if (operation === 'revoke') {
    await commit(env, [stmt(env, 'UPDATE beam_microsoft_connection SET enabled=0,version=version+1 WHERE singleton=1'), stmt(env, "UPDATE beam_microsoft_sources SET state='revoked'")], { actor, action: 'microsoft.revoke', subject: 'microsoft' })
    return { enabled: false }
  }
  insist(input.flag('consent'), 'microsoft_consent_required', 409)
  const site = input.text('site', { max: 300 }), drive = input.text('drive', { max: 300 }), reason = input.text('reason', { max: 2000 })
  const token = await graphToken(env)
  const metadata = await graphJson(token, `/sites/${segment(site)}`), library = await graphJson(token, `/sites/${segment(site)}/drives`)
  insist(metadata.id === site && typeof metadata.webUrl === 'string', 'microsoft_site_mismatch', 409)
  const url = microsoftUrl(metadata.webUrl)
  insist(url.protocol === 'https:' && /^[a-z0-9-]+\.sharepoint\.com$/i.test(url.hostname) && !url.username && !url.password, 'microsoft_site_refused', 409)
  insist(Array.isArray(library.value) && library.value.some((item: any) => item.id === drive) && !library['@odata.nextLink'], 'microsoft_library_not_proven', 409)
  await commit(env, [stmt(env, `INSERT INTO beam_microsoft_connection VALUES(1,1,?,?,?,?,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET
    enabled=1,tenant_id=excluded.tenant_id,site_id=excluded.site_id,drive_id=excluded.drive_id,hostname=excluded.hostname,version=excluded.version,approved_by=excluded.approved_by,approved_at=excluded.approved_at,reason=excluded.reason`,
    env.ENTRA_TENANT_ID!, site, drive, url.hostname, (current?.version ?? 0) + 1, actor.id, now(), reason), stmt(env, "UPDATE beam_microsoft_sources SET state='revoked'")],
  { actor, action: 'microsoft.connect', subject: site, detail: { drive, reason } })
  return { enabled: true, site, drive }
}
export async function checkMicrosoft(env: Bindings, actor: Actor, input: Input) {
  microsoftOwner(actor); insist(input.flag('consent'), 'microsoft_consent_required', 409)
  const token = await graphToken(env)
  const directory = await graphJson(token, '/users?$select=id,assignedLicenses&$top=100')
  insist(Array.isArray(directory.value), 'microsoft_directory_invalid', 502)
  const result: Record<string, unknown> = { token: 'accepted', directoryUsers: directory.value.length, licensedUsers: directory.value.filter((item: any) => item.assignedLicenses?.length).length, directoryComplete: !directory['@odata.nextLink'] }
  try { const sites = await graphJson(token, '/sites?search=*'); insist(Array.isArray(sites.value), 'microsoft_sites_invalid', 502); result.sites = sites.value.map((site: any) => ({ id: site.id, name: site.displayName })); result.sitesComplete = !sites['@odata.nextLink'] }
  catch (error) { if (!(error instanceof Error) || !error.message.startsWith('microsoft_')) throw error; result.sitesUnavailable = error.message; if (error instanceof BeamError) { result.sitesProviderStatus = (error.detail as any)?.providerStatus ?? null; result.sharePointLicenseMissing = (error.detail as any)?.sharePointLicenseMissing ?? false } }
  await commit(env, [], { actor, action: 'microsoft.check', subject: 'microsoft', detail: { directoryUsers: result.directoryUsers, licensedUsers: result.licensedUsers, sitesUnavailable: result.sitesUnavailable ?? null } })
  return result
}
