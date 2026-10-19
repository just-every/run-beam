// RER's server-owned provisioning flag is the owner's import-door approval.
// Repeated owner paths heal a claim/enable interruption without reopening a disabled door.
import type { Bindings } from '../../auth.server'
import { enableDoorAtFirstClaim } from '../../modules/import-kit/src/door/index'
import type { D1Database } from '../../modules/import-kit/src/d1/index'
import { one } from '../core'
import { importInstallationId } from './door'

export async function provisionImportDoor(env: Bindings) {
  if (env.RER_IMPORT_DOOR !== 'on') return
  const owner = await one<{ id: string }>(env, "SELECT id FROM oa_operators WHERE role='owner' AND status='active' AND lower(email)=?", env.OWNER_EMAIL.toLowerCase())
  if (!owner) return
  await enableDoorAtFirstClaim(env.DB as unknown as D1Database, importInstallationId, {
    sql: "EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active' AND lower(email)=?)",
    params: [owner.id, env.OWNER_EMAIL.toLowerCase()],
  })
}
