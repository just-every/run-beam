// Both the owner screen and RER enter the same retained, reviewed import pipeline.
import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { createImportDoorHandler } from '../../modules/import-kit/src/door/index'
import { createImportOperatorHandler, readImportDoorHistory, writeImportDoorSettings } from '../../modules/import-kit/src/door/operator'
import type { D1Database, D1Sql } from '../../modules/import-kit/src/d1/index'
import { readD1ImportUndoReport } from '../../modules/import-kit/src/d1/index'
import { requireOwner, type Actor } from '../actor'
import { all, insist, one } from '../core'
import type { Input } from '../input'
import { talentLmsSource, mappingVersion } from './source'
import { historyTargets } from './target'
import { legacyHistory, undoLegacyImport } from './legacy'
import { sql, transact } from '../../modules/import-kit/src/door/store'

// A fixed seed key survives later claim configuration and remains the door's
// permanent settings/history key. Grants still bind to the configured claim id.
export const importInstallationId = 'beam-history'
export const importNamespace = 'talentlms'
const database = (env: Bindings) => env.DB as unknown as D1Database

export function ownerPredicate(actor: Pick<Actor, 'sessionId' | 'id' | 'email'>): D1Sql {
  return { sql: `EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id
    JOIN beam_members m ON m.operator_id=o.id WHERE s.id=? AND m.id=? AND lower(o.email)=?
    AND s.revoked_at IS NULL AND s.expires_at>unixepoch()*1000 AND o.version=s.operator_version
    AND o.status='active' AND o.role='owner'
    AND (s.kind!='oidc' OR EXISTS(SELECT 1 FROM oa_provider_sessions p JOIN oa_auth_settings a
      ON a.singleton=1 AND a.idp_sign_in=1 AND a.generation=p.generation WHERE p.session_id=s.id))
    AND NOT EXISTS(SELECT 1 FROM oa_provider_session_pins pin WHERE pin.session_id=s.id AND NOT EXISTS(
      SELECT 1 FROM oa_identity_providers provider WHERE provider.provider_id=pin.provider_id AND provider.status='linked'
      AND provider.issuer=pin.issuer AND provider.client_id=pin.client_id AND provider.linked_at=pin.linked_at)))`, params: [actor.sessionId, actor.id, actor.email] }
}

/** This is the only source allow-list, shared by both authorities. Each call
 * gets isolated parser/mapping state for its complete original bundle. */
export const importSource = (env: Bindings, owner: string) => (name: string) =>
  name === importNamespace ? talentLmsSource(env, owner) : null

const notFound = () => Response.json({error: 'not_found'}, {status: 404, headers: {'cache-control': 'no-store'}})
export async function beamImportDoor(request: Request, original: Bindings): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (!path.startsWith('/api/rer/import/') && !path.startsWith('/api/operator/import/')) return null
  const env = runtimeBindings(original)
  const owner = await one<{id: string}>(env, `SELECT m.id FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id
    WHERE o.role='owner' AND o.status='active' AND lower(o.email)=?`, env.OWNER_EMAIL.toLowerCase())
  if (!owner) return notFound()
  const source = importSource(env, owner.id)
  const runtime = {database: database(env), targets: historyTargets, ownerPrincipalId: owner.id,
    destination: 'history', format: 'json' as const, reversalPolicy: 'preserve-conflicts' as const,
    limits: {maxBytes: 64 * 1024 * 1024, maxRecords: 100_000, maxRecordBytes: 64 * 1024 * 1024}}
  if (path.startsWith('/api/rer/import/')) {
    if (!env.RER_OWNER_CLAIM_PUBLIC_KEYS || !env.RER_OWNER_CLAIM_ISSUER || !env.RER_OWNER_CLAIM_INSTALLATION_ID) return notFound()
    let publicKeys: Record<string, JsonWebKey>
    try { publicKeys = JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS) } catch { return notFound() }
    return createImportDoorHandler({...runtime, source, installationId: importInstallationId,
      claim: {issuer: env.RER_OWNER_CLAIM_ISSUER, installationId: env.RER_OWNER_CLAIM_INSTALLATION_ID,
        appOrigin: env.RER_OWNER_CLAIM_APP_ORIGIN ?? env.AUTH_ORIGIN, expectedEmail: env.OWNER_EMAIL, publicKeys}})(request)
  }
  if (request.headers.has('authorization')) return Response.json({error: 'owner_required'}, {status: 401})
  const listed = await source(request.headers.get('X-Import-Source') ?? '')
  if (!listed) return Response.json({error: 'unknown_import_source'}, {status: 400})
  return createImportOperatorHandler({...runtime, ...listed, namespace: importNamespace,
    installationId: importInstallationId, appOrigin: env.AUTH_ORIGIN, ownerEmail: env.OWNER_EMAIL,
    async authorize(incoming) {
      // Beam's CSRF policy is the exact app Origin. Never trust a caller's
      // owner id, a delegated bearer credential, or a view-as cookie.
      if (incoming.headers.get('Origin') !== env.AUTH_ORIGIN || incoming.headers.has('authorization')) return null
      const session = await operatorAuth(env).getSession(incoming)
      if (!session || session.operator.role !== 'owner' || session.operator.email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) return null
      const predicate = ownerPredicate({id: owner.id, sessionId: session.id, email: env.OWNER_EMAIL.toLowerCase()})
      // A viewer may never mutate as the underlying owner.
      if (incoming.headers.get('cookie')?.split(/;\s*/).some(part => part.startsWith('beam_view=') && part !== 'beam_view=')) return null
      return predicate
    },
  })(request)
}

export async function importSettings(env: Bindings, actor: Actor) {
  requireOwner(actor)
  // Seed initialization never overwrites a concurrent explicit enable action.
  // Keep authority stable before and after INSERT OR IGNORE; absence is not an
  // authority predicate because the insert itself changes it.
  await transact(database(env), ownerPredicate(actor), [
    sql('INSERT OR IGNORE INTO ik_door_settings(installation_id,enabled) VALUES(?,0)', importInstallationId),
  ])
  const row = await one<{enabled: number}>(env, 'SELECT enabled FROM ik_door_settings WHERE installation_id=?', importInstallationId)
  insist(row, 'import_settings_not_found', 503)
  const revokedKeys = (await all<{kid: string}>(env, 'SELECT kid FROM ik_door_revoked_keys WHERE installation_id=? ORDER BY kid', importInstallationId)).map(row => row.kid)
  return {enabled: row.enabled === 1, revokedKeys, configured: !!(env.RER_OWNER_CLAIM_PUBLIC_KEYS && env.RER_OWNER_CLAIM_ISSUER && env.RER_OWNER_CLAIM_INSTALLATION_ID)}
}
export async function saveImportSettings(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const revoke = input.text('revokeKey', {optional: true, max: 64})
  await writeImportDoorSettings(database(env), importInstallationId, {enabled: input.flag('enabled'), revokedKids: revoke ? [revoke] : []}, ownerPredicate(actor))
  return importSettings(env, actor)
}

export async function importJobs(env: Bindings, actor: Actor) {
  requireOwner(actor)
  const [rows, legacy] = await Promise.all([
    readImportDoorHistory(database(env), importInstallationId, ownerPredicate(actor)),
    legacyHistory(env, actor, ownerPredicate(actor)),
  ])
  const current = await Promise.all(rows.map(async row => {
    const job = await one<{namespace: string; mapping_version: string; total: number}>(env, 'SELECT namespace,mapping_version,total FROM ik_jobs WHERE id=?', row.jobId)
    insist(job, 'import_job_not_found', 404)
    const report = row.state === 'undone' ? await readD1ImportUndoReport(row.jobId, {
      destination: 'history', namespace: job.namespace, mappingVersion: job.mapping_version || mappingVersion,
      storage: {database: database(env), targets: historyTargets}, authorization: {principalId: actor.id, predicate: () => ownerPredicate(actor)},
    }) : null
    return {...row, legacy: false as const, id: row.jobId, appliedAt: Date.parse(row.approvedAt), effects: job.total,
      retained: report?.dispositions.filter(item => item.disposition === 'retained').map(item => ({target: item.targetId, reason: item.reason})) ?? []}
  }))
  return [...current, ...legacy].sort((a, b) => (b.appliedAt ?? 0) - (a.appliedAt ?? 0) || a.id.localeCompare(b.id))
}

export async function legacyUndo(env: Bindings, actor: Actor, legacyJobId: string) {
  return undoLegacyImport(env, actor, legacyJobId, ownerPredicate(actor))
}
