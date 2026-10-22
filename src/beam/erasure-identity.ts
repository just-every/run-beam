import type { D1Sql, D1TargetAdapter } from '../modules/import-kit/src/d1/index'
import { historyTargets } from './movein/target'
const personal = ['email','name','operator_id','employee_id','preferred_name','mobile','language','manager_id','job_role','department','location','hire_date','custom_json','transfer_date','username','time_zone']
/** A person target is the personal directory projection. Its stable member id survives as anonymous evidence attribution. */
export const erasureTargets: D1TargetAdapter = {
  ...historyTargets,
  async read(db, destination, kind, id) {
    if (kind !== 'person') return historyTargets.read(db, destination, kind, id)
    const row = await db.prepare('SELECT * FROM beam_members WHERE id=? AND erased_at IS NULL').bind(id).first<Record<string, any>>()
    return row ? { destination, targetKind: kind, targetId: id, revision: String(row.created_at), value: Object.fromEntries(personal.map(key => [key,row[key] ?? null])) } : undefined
  },
  matches(row, destination, kind, id) {
    if (kind !== 'person') return historyTargets.matches(row, destination, kind, id)
    return row ? { sql: `EXISTS(SELECT 1 FROM beam_members WHERE id=? AND erased_at IS NULL AND ${personal.map(key => `${key} IS ?`).join(' AND ')})`, params: [id,...personal.map(key => (row.value as Record<string,any>)[key])] }
      : { sql: 'NOT EXISTS(SELECT 1 FROM beam_members WHERE id=? AND erased_at IS NULL)', params: [id] }
  },
}
export const personIdentitySql = (member: string, at: number): D1Sql[] => [{
  sql: `UPDATE beam_members SET email=NULL,name='Erased person',operator_id=NULL,employee_id=NULL,preferred_name=NULL,mobile=NULL,
    language=NULL,employment='terminated',manager_id=NULL,job_role=NULL,department=NULL,location=NULL,hire_date=NULL,custom_json='{}',
    transfer_date=NULL,username=NULL,time_zone=NULL,erased_at=COALESCE(erased_at,?) WHERE id=?`, params: [at,member],
}]
