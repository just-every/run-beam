import { one } from '../core'
import { connection, ready, type EntraBindings } from './common'

/** Base keeps its session, version and generation checks. The seed also reads current
 * tenant registration and provisioning authority before serving a managed user. */
export async function entraSessionAllowed(env: EntraBindings, operatorId: string): Promise<boolean> {
 const user = await one(env, 'SELECT id FROM beam_entra_users WHERE operator_id=?', operatorId)
 if (!user) return true
 if (!ready(env, await connection(env))) return false
 return !!await one(env, `SELECT 1 FROM beam_entra_users u JOIN beam_members m ON m.id=u.member_id JOIN oa_operators o ON o.id=u.operator_id WHERE u.id=? AND u.active=1 AND u.deleted_at IS NULL AND o.status='active' AND o.role='member' AND m.erased_at IS NULL AND m.erasure_pending=0 AND m.employment<>'terminated' AND EXISTS(SELECT 1 FROM beam_entra_subjects a WHERE a.user_id=u.id) AND EXISTS(SELECT 1 FROM beam_entra_group_members gm JOIN beam_entra_group_roles gr ON gr.group_id=gm.group_id WHERE gm.user_id=u.id)`, user.id)
}
