import type { EntraBindings } from './common'
import { stmt, now } from '../core'

// Execute after group or user changes in the SAME D1 batch. Track only role rows
// first introduced here, preserving roles independently granted before SCIM.
export function reconcileRoles(env: EntraBindings) {
 return [
  stmt(env, `DELETE FROM beam_member_roles WHERE EXISTS(SELECT 1 FROM beam_entra_role_grants x WHERE x.member_id=beam_member_roles.member_id AND x.role=beam_member_roles.role)
   AND NOT EXISTS(SELECT 1 FROM beam_entra_users u JOIN beam_entra_group_members gm ON gm.user_id=u.id JOIN beam_entra_group_roles gr ON gr.group_id=gm.group_id JOIN beam_entra_connection c ON c.singleton=1 WHERE u.member_id=beam_member_roles.member_id AND u.active=1 AND c.enabled=1 AND gr.role=beam_member_roles.role)`),
  stmt(env, `DELETE FROM beam_entra_role_grants WHERE NOT EXISTS(SELECT 1 FROM beam_member_roles r WHERE r.member_id=beam_entra_role_grants.member_id AND r.role=beam_entra_role_grants.role)`),
  stmt(env, `INSERT OR IGNORE INTO beam_entra_role_grants(member_id,role) SELECT DISTINCT u.member_id,gr.role FROM beam_entra_users u JOIN beam_entra_group_members gm ON gm.user_id=u.id JOIN beam_entra_group_roles gr ON gr.group_id=gm.group_id JOIN beam_entra_connection c ON c.singleton=1 WHERE u.active=1 AND c.enabled=1 AND NOT EXISTS(SELECT 1 FROM beam_member_roles r WHERE r.member_id=u.member_id AND r.role=gr.role)`),
  stmt(env, `INSERT OR IGNORE INTO beam_member_roles(member_id,role) SELECT member_id,role FROM beam_entra_role_grants`),
 ]
}
export const revokeUsers = (env: EntraBindings, sql: string, ...args: unknown[]) => stmt(env, `UPDATE oa_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE operator_id IN (SELECT operator_id FROM beam_entra_users WHERE ${sql})`, now(), ...args)
