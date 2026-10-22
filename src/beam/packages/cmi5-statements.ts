import type { Bindings } from '../../auth.server'
import { BeamError, commit, insist, newId, now, one, stmt, type Row } from '../core'
import { getStatement, sendStatements } from './xapi-client'
import { lrsAuthorization } from './xapi-catalog'
import { canonicalJSON, statementDigest, type XapiStatement } from './xapi-protocol'
import { CMI5, cmi5Context, type Cmi5Session } from './cmi5-runtime'
export const verbs: Record<string, string> = Object.fromEntries(['launched', 'initialized', 'completed', 'passed', 'failed', 'terminated', 'abandoned', 'waived', 'satisfied'].map(name => [name, ['abandoned', 'waived', 'satisfied'].includes(name) ? `https://w3id.org/xapi/adl/verbs/${name}` : `http://adlnet.gov/expapi/verbs/${name}`]))
function contains(actual: any, expected: any): boolean {
  if (!expected || typeof expected !== 'object') return actual === expected
  return !!actual && typeof actual === 'object' && Object.entries(expected).every(([key, value]) => Array.isArray(value) ? Array.isArray(actual[key]) && value.every(item => actual[key].some((a: any) => contains(a, item))) : contains(actual[key], value))
}
export { contains as cmi5Contains }
export async function retainCmi5(env: Bindings, value: Cmi5Session, original: XapiStatement, verb: string) {
  const digest = await statementDigest(original), prior = await one(env, 'SELECT * FROM beam_cmi5_statements WHERE id=?', original.id)
  insist(!prior || prior.session_id === value.session.id && prior.digest === digest, 'cmi5_statement_conflict', 409)
  if (prior?.status === 'accepted') return
  await env.DB.prepare("INSERT OR IGNORE INTO beam_cmi5_statements(id,session_id,digest,original_json,verb,status,received_at) VALUES(?,?,?,?,?,'pending',?)").bind(original.id, value.session.id, digest, JSON.stringify(original), verb, now()).run()
  const retained = await one(env, 'SELECT * FROM beam_cmi5_statements WHERE id=?', original.id)
  insist(retained?.digest === digest && retained.session_id === value.session.id, 'cmi5_statement_conflict', 409)
  try {
    const connection = await lrsAuthorization(env, value.session.connection_id)
    await sendStatements(connection.endpoint, connection.authorization, [original])
    const receipt = await getStatement(connection.endpoint, connection.authorization, original.id)
    insist(contains(receipt.statement, original), 'cmi5_lrs_readback_mismatch', 502)
    await commit(env, [stmt(env, "UPDATE beam_cmi5_statements SET status='accepted',accepted_at=?,lrs_stored=?,failure=NULL WHERE id=? AND digest=?", now(), receipt.statement.stored ?? null, original.id, digest)], { actor: value.actor, action: 'cmi5.statement', subject: original.id, detail: { session: value.session.session_uuid, verb } })
  } catch (error) {
    await env.DB.prepare('UPDATE beam_cmi5_statements SET failure=? WHERE id=?').bind(error instanceof BeamError ? error.code : 'cmi5_lrs_unavailable', original.id).run()
    throw error
  }
}
export async function recordCmi5(env: Bindings, value: Cmi5Session, verb: string) {
  const prior = await one(env, 'SELECT original_json FROM beam_cmi5_statements WHERE session_id=? AND verb=? ORDER BY rowid LIMIT 1', value.session.id, verb)
  const context: Row = cmi5Context(value)
  if (verb === 'launched') context.extensions = { ...context.extensions, [`${CMI5}context/extensions/launchmode`]: value.session.preview ? 'Browse' : 'Normal', [`${CMI5}context/extensions/moveon`]: value.sco.moveOn, ...(value.sco.masteryScore === null ? {} : { [`${CMI5}context/extensions/masteryscore`]: value.sco.masteryScore }) }
  const original = prior ? JSON.parse(prior.original_json) : { id: newId(), actor: value.identity, verb: { id: verbs[verb] }, object: { objectType: 'Activity', id: verb === 'satisfied' ? value.pkg.manifest.courseIri : value.sco.id, ...(verb === 'satisfied' ? { definition: { type: `${CMI5}activitytype/course` } } : {}) }, context, timestamp: new Date().toISOString() }
  await retainCmi5(env, value, original, verb)
}
