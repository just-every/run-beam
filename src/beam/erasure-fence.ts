// Value-free identity admission and the Base portability redaction checkpoint.
import type { Bindings } from '../auth.server'
import { all, insist, newId, one, sha256Hex, stmt } from './core'
import type { D1Sql } from '../modules/import-kit/src/d1/index'
const digest = (value: string) => sha256Hex(new TextEncoder().encode(value))
export async function identityDigest(env: Bindings, value: string) {
  // The installation's source identity survives archive transfer; no cross-installation join key.
  await stmt(env, 'INSERT OR IGNORE INTO rer_portability_state(id,source_identity) VALUES(1,?)', newId()).run()
  const state = await one(env, 'SELECT source_identity FROM rer_portability_state WHERE id=1')
  return digest(`${state!.source_identity}\0identity\0${value.trim().toLowerCase()}`)
}
export async function refuseErasedIdentity(env: Bindings, values: (string | null | undefined)[]) {
  if (!await one(env, 'SELECT 1 FROM beam_erasure_tombstones LIMIT 1')) return
  for (const value of values.filter(Boolean) as string[]) insist(!await one(env, 'SELECT 1 FROM beam_erasure_tombstones WHERE digest=?', await identityDigest(env, value)), 'erased_identity', 409)
}
export async function redactionCheckpoint(env: Bindings): Promise<D1Sql[]> {
  await stmt(env, 'INSERT OR IGNORE INTO rer_portability_state(id,source_identity) VALUES(1,?)', newId()).run()
  const state = (await one(env, 'SELECT source_identity FROM rer_portability_state WHERE id=1'))!
  // Same canonical [source,table,key] checkpoint as Base's redactionStatements.
  const hash = await digest(JSON.stringify([state.source_identity, 'rer_portability_state', { id: 1 }]))
  return [
    { sql: 'INSERT OR IGNORE INTO rer_portability_journal(source,tombstone) VALUES(?,?)', params: [state.source_identity, hash] },
    { sql: 'UPDATE rer_portability_state SET epoch=epoch+1 WHERE id=1' },
    { sql: 'INSERT INTO rer_portability_epochs SELECT source_identity,epoch FROM rer_portability_state WHERE id=1 ON CONFLICT(source) DO UPDATE SET epoch=MAX(epoch,excluded.epoch)' },
  ]
}
export const preparedCheckpoint = async (env: Bindings) => (await redactionCheckpoint(env)).map(item => stmt(env, item.sql, ...(item.params ?? [])))
export async function erasureJournal(env: Bindings) {
  const state = (await one(env, 'SELECT source_identity,epoch FROM rer_portability_state WHERE id=1'))!
  return { sourceIdentity: state?.source_identity, epoch: state?.epoch ?? 0, journal: (await all(env, 'SELECT tombstone FROM rer_portability_journal WHERE source=? ORDER BY tombstone', state?.source_identity ?? '')).map(row => row.tombstone) }
}
