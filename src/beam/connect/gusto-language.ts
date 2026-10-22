// Manual language-only pull. No employee creation, payroll access, invitations or provider writes.
// Gusto primary schemas: /app-integrations/reference/get-v1-employees and
// /embedded-payroll/reference/get-v1-employees-employee_id-custom_fields at docs.gusto.com.
import type { Bindings } from '../../auth.server'
import { requireOwner, type Actor } from '../actor'
import { BeamError, all, commit, insist, newId, now, one, stmt } from '../core'
import type { Input } from '../input'

const ROOTS = { demo: 'https://api.gusto-demo.com', production: 'https://api.gusto.com' } as const
const opaque = (input: Input, name: string) => { const value = input.text(name, { max: 100 }); insist(/^[a-zA-Z0-9_-]+$/.test(value), 'invalid_gusto_identifier'); return value }
function owner(actor: Actor) { requireOwner(actor); insist(!actor.agent && !actor.viewAs, 'human_owner_required', 403) }
const FAILURES: Record<string, string> = {
  gusto_token_missing: 'Configure the server-held Gusto access token before pulling.',
  gusto_provider_denied: 'Gusto refused the read. Check employees:read permission and account access, then pull explicitly.',
  gusto_provider_unavailable: 'Gusto did not return a readable response. Check the connection, then pull explicitly.',
  gusto_provider_malformed: 'Gusto returned an unexpected employee or custom-field shape. No preference was changed.',
  gusto_identity_mismatch: 'The provider company or employee does not match the consented identity.',
  gusto_directory_changed: 'The local employee identity or access changed. Review the mapping and consent again.',
  gusto_field_missing: 'The consented company custom field has no unique employee response.',
  gusto_language_invalid: 'The mapped field must contain one BCP 47 language tag, such as es-US.',
  gusto_consent_changed: 'Read consent or the enabling owner authority changed. No preference was changed.',
}

export async function configureGustoLanguage(env: Bindings, actor: Actor, input: Input) {
  owner(actor)
  insist(input.flag('consent'), 'gusto_consent_required', 409)
  const member = input.text('member'), employeeId = input.text('employeeId', { max: 100 })
  const person = await one(env, 'SELECT employee_id FROM beam_members WHERE id=?', member)
  insist(person?.employee_id && person.employee_id === employeeId, 'gusto_directory_changed', 409)
  const employeeUuid = opaque(input, 'employeeUuid'), companyUuid = opaque(input, 'companyUuid'), fieldId = opaque(input, 'fieldId')
  const environment = input.text('environment'); insist(environment === 'demo' || environment === 'production', 'invalid_gusto_environment')
  const current = await one(env, 'SELECT id,version FROM beam_gusto_language_mappings WHERE member_id=?', member), version = input.integer('version')!
  insist(version === (current?.version ?? 0), 'gusto_mapping_changed', 409)
  const id = current?.id ?? newId(), at = now()
  await commit(env, [stmt(env, `INSERT INTO beam_gusto_language_mappings(id,member_id,employee_id,employee_uuid,company_uuid,field_id,environment,version,enabled,consented_by,consented_at)
    VALUES(?,?,?,?,?,?,?,1,1,?,?) ON CONFLICT(member_id) DO UPDATE SET employee_id=excluded.employee_id,
    employee_uuid=excluded.employee_uuid,company_uuid=excluded.company_uuid,field_id=excluded.field_id,environment=excluded.environment,
    version=version+1,enabled=1,consented_by=excluded.consented_by,consented_at=excluded.consented_at,
    last_outcome=NULL,last_failure=NULL WHERE beam_gusto_language_mappings.version=?`, id, member, employeeId, employeeUuid, companyUuid, fieldId, environment, actor.id, at, version)],
  { actor, action: 'gusto.language.configure', subject: id, detail: { member, fields: ['language'], environment, consent: true } })
  const saved = await one(env, 'SELECT version,consented_at FROM beam_gusto_language_mappings WHERE id=?', id)
  insist(saved?.version === version + 1 && saved.consented_at === at, 'gusto_mapping_changed', 409)
  return { id, version: version + 1, enabled: true }
}
export async function revokeGustoLanguage(env: Bindings, actor: Actor, input: Input) {
  owner(actor)
  const id = input.text('mapping'), version = input.integer('version')!
  insist(await one(env, 'SELECT 1 FROM beam_gusto_language_mappings WHERE id=? AND version=?', id, version), 'gusto_mapping_changed', 409)
  await commit(env, [stmt(env, 'UPDATE beam_gusto_language_mappings SET enabled=0,version=version+1 WHERE id=? AND version=?', id, version)], { actor, action: 'gusto.language.revoke', subject: id, detail: { fields: ['language'] } })
  return { id, version: version + 1, enabled: false }
}
async function providerRead(root: string, path: string, token: string) {
  let response: Response
  try { response = await fetch(root + path, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-Gusto-API-Version': '2026-06-15' }, redirect: 'manual', signal: AbortSignal.timeout(15_000) }) }
  catch { throw new BeamError('gusto_provider_unavailable', 502) }
  insist(response.ok, response.status === 401 || response.status === 403 ? 'gusto_provider_denied' : 'gusto_provider_unavailable', 502)
  // Keep unrelated HR/payroll data in memory only, bounded before JSON parsing.
  const reader = response.body?.getReader(); insist(reader, 'gusto_provider_malformed', 502)
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 250_000) { await reader.cancel(); throw new BeamError('gusto_provider_malformed', 502) } chunks.push(value) }
  } catch (error) { if (error instanceof BeamError) throw error; throw new BeamError('gusto_provider_unavailable', 502) }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.length }
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new BeamError('gusto_provider_malformed', 502) }
}

export async function pullGustoLanguage(env: Bindings, actor: Actor, input: Input) {
  owner(actor)
  const id = input.text('mapping'), version = input.integer('version')!, at = now()
  const mapping = await one(env, 'SELECT * FROM beam_gusto_language_mappings WHERE id=? AND version=?', id, version)
  insist(mapping?.enabled === 1, 'gusto_consent_required', 409)
  try {
    insist(await one(env, `SELECT 1 FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id
      WHERE m.id=? AND m.employment<>'terminated' AND o.status='active' AND o.role='owner'`, mapping.consented_by), 'gusto_consent_changed', 409)
    const token = (env as Bindings & { GUSTO_ACCESS_TOKEN?: string }).GUSTO_ACCESS_TOKEN
    insist(token && token.trim(), 'gusto_token_missing', 409)
    const local = await one(env, `SELECT m.employee_id FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id
      WHERE m.id=? AND m.employment<>'terminated' AND o.status='active'`, mapping.member_id)
    insist(local?.employee_id === mapping.employee_id, 'gusto_directory_changed', 409)
    const root = ROOTS[mapping.environment as keyof typeof ROOTS]
    insist(root, 'gusto_provider_malformed', 409)
    const employee = await providerRead(root, `/v1/employees/${encodeURIComponent(mapping.employee_uuid)}`, token)
    insist(employee && typeof employee === 'object' && !Array.isArray(employee), 'gusto_provider_malformed', 502)
    insist(employee.uuid === mapping.employee_uuid && employee.company_uuid === mapping.company_uuid, 'gusto_identity_mismatch', 409)
    const fields = await providerRead(root, `/v1/employees/${encodeURIComponent(mapping.employee_uuid)}/custom_fields`, token)
    insist(fields && Array.isArray(fields.custom_fields) && fields.custom_fields.length <= 500, 'gusto_provider_malformed', 502)
    const matches = fields.custom_fields.filter((field: any) => field?.company_custom_field_id === mapping.field_id)
    insist(matches.length === 1, 'gusto_field_missing', 409)
    const field = matches[0]
    insist(['text', 'radio'].includes(field.type) && typeof field.value === 'string' && /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(field.value) && field.value.length <= 35, 'gusto_language_invalid', 409)
    let language: string
    try { language = Intl.getCanonicalLocales(field.value)[0] } catch { throw new BeamError('gusto_language_invalid', 409) }
    // One transaction rechecks consent, stable local identity and current owner authority before writing.
    const guard = `EXISTS(SELECT 1 FROM beam_gusto_language_mappings g JOIN beam_members authority ON authority.id=g.consented_by
      JOIN oa_operators owner ON owner.id=authority.operator_id WHERE g.id=? AND g.version=? AND g.enabled=1
      AND owner.status='active' AND owner.role='owner' AND authority.employment<>'terminated')`
    const result = await env.DB.batch([
      stmt(env, `UPDATE beam_members SET language=? WHERE id=? AND employee_id=? AND employment<>'terminated'
        AND EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=beam_members.operator_id AND o.status='active') AND ${guard}`, language, mapping.member_id, mapping.employee_id, id, version),
      stmt(env, `UPDATE beam_gusto_language_mappings SET last_attempt_at=?,last_synced_at=?,last_outcome='updated',last_failure=NULL WHERE id=? AND version=? AND changes()=1`, at, now(), id, version),
      stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,'gusto.language.pull',?,? WHERE changes()=1`, now(), actor.id, id, JSON.stringify({ member: mapping.member_id, fields: ['language'], outcome: 'updated' })),
    ])
    insist(result[0].meta.changes === 1, 'gusto_consent_changed', 409)
    return { id, outcome: 'updated', lastSyncedAt: now() }
  } catch (error) {
    const code = error instanceof BeamError && Object.hasOwn(FAILURES, error.code) ? error.code : 'gusto_provider_unavailable'
    await commit(env, [stmt(env, 'UPDATE beam_gusto_language_mappings SET last_attempt_at=?,last_outcome=?,last_failure=? WHERE id=? AND version=?', at, code, FAILURES[code], id, version)], { actor, action: 'gusto.language.failure', subject: id, detail: { fields: ['language'], outcome: code } })
    return { id, outcome: code, failure: FAILURES[code] }
  }
}
export async function gustoLanguageView(env: Bindings, actor: Actor) {
  owner(actor)
  return { mappings: await all(env, `SELECT g.*,m.name AS memberName FROM beam_gusto_language_mappings g JOIN beam_members m ON m.id=g.member_id ORDER BY g.consented_at DESC`),
    people: await all(env, 'SELECT id,name,employee_id AS employeeId FROM beam_members WHERE employee_id IS NOT NULL ORDER BY name'),
    tokenConfigured: Boolean((env as Bindings & { GUSTO_ACCESS_TOKEN?: string }).GUSTO_ACCESS_TOKEN) }
}
