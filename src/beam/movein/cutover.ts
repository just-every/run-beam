// MOVE-008: owner-reviewed, write-free requirement comparison. Approval creates no enrollments or credit.
import type { Bindings } from '../../auth.server'
import { requireOwner, type Actor } from '../actor'
import { all, insist, newId, now, one, sha256Hex, stmt, type Row } from '../core'
import type { Input } from '../input'
import { canonicalJson } from '../../modules/import-kit/src/d1/index'
import type { D1Database } from '../../modules/import-kit/src/d1/index'
import { loadSnapshot } from '../../modules/import-kit/src/door/store'
import type { DoorRequest, DoorPlanRow } from '../../modules/import-kit/src/door/types'
import { historyTargets } from './target'
import { talentLmsSource } from './source'
import { importInstallationId, importNamespace, ownerPredicate } from './door'

function owner(actor:Actor) {requireOwner(actor);insist(!actor.agent&&!actor.app&&!actor.viewAs,'human_owner_required',403)}
// Exact, ordered state compared inside the final INSERT: no read/check/write race.
// Only decision lineage is stored; the state body never leaves this server or enters an audit.
const inventories:[string,string][]=[
 ['beam_imported_history','id,kind,payload,revision'], ['beam_members','id,email,employment,erased_at,operator_id'],
 ['oa_operators','id,status,role,version'], ['beam_courses','id,published_revision_id,retired_at'],
 ['beam_assignments','id,learner_id,course_id,course_revision_id,due_date,status'],
 ['beam_completions','id,learner_id,course_id,course_revision_id,expires_at'],
 ['beam_history_credits','id,course_id,approved_at,undone_at'],['beam_history_credit_people','credit_id,member_id,history_id,expires_at'],
 ['beam_cutover_credit_decisions','plan_id,course_id,decided_at'],
 ['ik_door_namespaces','installation_id,namespace,head_id,pending_id'], ['ik_door_plans','id,job_id,fingerprint,snapshot_hash,complete'],
 ['ik_jobs','id,state,checkpoint'], ['rer_portability_state','id,epoch,import_job,applying'],
]
const stateSql = `json_array(${inventories.map(([table,columns])=>`json((SELECT coalesce(json_group_array(json_array(${columns})),'[]') FROM (SELECT ${columns} FROM ${table} ORDER BY ${columns.split(',').slice(0,2).join(',')})))`).join(',')})`
async function state(env:Bindings){const row=await one<{body:string}>(env,`SELECT ${stateSql} AS body`);insist(row&&row.body.length<=1_500_000,'cutover_inventory_limit',413);return row.body}

async function comparison(env:Bindings,actor:Actor,planId:string){
 owner(actor)
 const basis=await state(env), at=now(), data=JSON.parse(basis) as any[][][]
 const plan=await one<DoorPlanRow & {state:string;approvedAt:string}>(env,`SELECT p.*,j.state,a.approved_at AS approvedAt FROM ik_door_plans p JOIN ik_jobs j ON j.id=p.job_id
   JOIN ik_door_approvals a ON a.plan_id=p.id JOIN ik_door_namespaces n ON n.head_id=p.id
   WHERE p.id=? AND p.installation_id=? AND p.namespace=? AND p.complete=1 AND n.pending_id IS NULL`,planId,importInstallationId,importNamespace)
 insist(plan?.state==='completed','cutover_completed_head_required',409)
 const source=await talentLmsSource(env,actor.id)
 // Snapshot validation reads destination/principal and the retained database only; authority stays the live owner session.
 const context:DoorRequest={options:{database:env.DB as unknown as D1Database,destination:'history',targets:historyTargets,...source,ownerPrincipalId:actor.id,format:'json'},via:'operator',authority:ownerPredicate(actor),epoch:0,
   access:{action:'status',installationId:importInstallationId,email:actor.email,namespace:importNamespace,maxBytes:64*1024*1024,maxChunks:1024,maxRecords:100000}}
 const snapshot=await loadSnapshot(context,plan)
 const requirements=snapshot.plan.entries.filter(entry=>entry.source.kind==='active-requirement')
 const rows:Row[]=[], gaps:string[]=[]
 if(!requirements.length)gaps.push('No employer-reviewed current-requirements sidecar is present; historical completion does not imply an active requirement.')
 const native=new Map(data[0].map(row=>[row[0],row])),members=new Map(data[1].map(row=>[row[0],row])),accounts=new Map(data[2].map(row=>[row[0],row])),courses=new Map(data[3].map(row=>[row[0],row]))
 const assignments=data[4],completions=data[5],credits=data[6],creditPeople=data[7],declined=data[8]
 const pairs=new Set<string>(),mappedCourses=new Set<string>()
 let validUntil=at+15*60*1000
 for(const entry of requirements){
   const effect=entry.effects.find(effect=>effect.targetKind==='requirement'), value=effect?.value as Row|undefined
   const issues:string[]=[]
   if(entry.rejection)issues.push(entry.rejection)
   if(!effect||!value){rows.push({source:entry.source.sourceId,issues:issues.length?issues:['Source requirement did not map.']});continue}
   const retained=native.get(effect.targetId)
   if(!retained||canonicalJson(JSON.parse(retained[2]))!==canonicalJson(value as any))issues.push('Retained requirement differs from the reviewed source; re-preview the original bundle.')
   const member=members.get(value.member),course=courses.get(value.mappedCourse),account=member&&accounts.get(member[4])
   if(!member||member[2]!=='active'||member[3]!==null||!account||account[1]!=='active')issues.push('No active person with a sign-in account; resolve People and re-preview the bundle.')
   if(!course||course[2]!==null||!course[1])issues.push('No live published mapped course; resolve the course mapping and re-preview.')
   if(value.unsupportedFields?.length)issues.push(`Unsupported source fields: ${value.unsupportedFields.join(', ')}; retained in the original.`)
   const open=assignments.filter(row=>row[1]===value.member&&row[2]===value.mappedCourse&&row[5]==='open')
   const completed=completions.filter(row=>row[1]===value.member&&row[2]===value.mappedCourse&&row[3]===course?.[1]&&(row[4]===null||row[4]>at))
   const eligibleCredit=credits.filter(row=>row[1]===value.mappedCourse&&row[3]===null&&row[2]>=Date.parse(plan.approvedAt))
   const credited=creditPeople.filter(row=>row[1]===value.member&&row[3]>at&&eligibleCredit.some(credit=>credit[0]===row[0]))
   const creditDecision=eligibleCredit.length?'approved':declined.some(row=>row[0]===planId&&row[1]===value.mappedCourse)?'explicitly_declined':'pending'
   if(value.mappedCourse)mappedCourses.add(value.mappedCourse)
   if(value.active){
     pairs.add(`${value.member}:${value.mappedCourse}`)
     if(!completed.length&&!credited.length&&!(open.length===1&&open[0][3]===course?.[1]&&(!value.dueOn||open[0][4]===value.dueOn)))issues.push('Active source requirement lacks one equivalent current assignment, native completion or approved history credit.')
     if(open.length>1)issues.push('More than one open Beam assignment.')
     if(creditDecision==='pending')issues.push('Imported-history credit decision is pending; approve through the credit door or explicitly decline here before first HRIS enrollment.')
   }else if(open.length)issues.push('Closed source requirement still has an open Beam assignment; resolve it through the normal manager door.')
   for(const expiry of [...completed.map(row=>row[4]),...credited.map(row=>row[3])])if(typeof expiry==='number')validUntil=Math.min(validUntil,expiry)
   rows.push({source:entry.source.sourceId,sourceEmail:value.email,sourceCourse:value.sourceCourse,member:value.member,course:value.mappedCourse,active:value.active,dueOn:value.dueOn,openAssignments:open.length,nativeCompletions:completed.length,credited:credited.length,creditDecision,issues})
 }
 for(const assignment of assignments.filter(row=>row[5]==='open'&&mappedCourses.has(row[2])&&!pairs.has(`${row[1]}:${row[2]}`)))gaps.push(`Beam assignment ${assignment[0]} has no active source requirement; resolve it before approving.`)
 // The read remains write-free; changing any basis during comparison refuses approval.
 const digest=await sha256Hex(new TextEncoder().encode(basis)),current=await one<Row>(env,'SELECT id,approved_at,restored FROM beam_cutover_approvals WHERE plan_id=? AND basis_sha256=? ORDER BY approved_at DESC LIMIT 1',planId,digest)
 return {basis,view:{plan:planId,sourceFingerprint:plan.fingerprint,bundleSha256:plan.bundle_sha256,digest,validUntil,rows,gaps,
   counts:{source:requirements.length,active:rows.filter(row=>row.active).length,unmatched:rows.filter(row=>!row.member||!row.course).length,differences:rows.filter(row=>row.issues.length).length},
   canApprove:!gaps.length&&rows.length>0&&rows.every(row=>!row.issues.length),approval:current?.restored===0?{id:current.id,at:current.approved_at}:null,
   note:'Current-requirement shadow only. Content rights, missing assets, package qualification and full-estate migration remain separate unresolved obligations. Approval creates no assignments, credit or provider action; first HRIS enrollment remains unavailable under AUTO-002.'}}
}
export async function cutoverPreview(env:Bindings,actor:Actor,planId:string){return(await comparison(env,actor,planId)).view}
export async function declineCutoverCredit(env:Bindings,actor:Actor,input:Input){
 owner(actor);const plan=input.text('plan'),course=input.text('course'),reason=input.text('reason',{max:1000}),{basis,view}=await comparison(env,actor,plan)
 insist(input.text('digest')===view.digest,'cutover_stale',409)
 insist(view.rows.some(row=>row.course===course&&row.active),'cutover_course_not_mapped',409)
 const at=now(),authority=ownerPredicate(actor)
 const result=await env.DB.batch([stmt(env,`INSERT INTO beam_cutover_credit_decisions(plan_id,course_id,decided_by,decided_at,reason)
   SELECT ?,?,?,?,? WHERE (${stateSql})=? AND (${authority.sql}) ON CONFLICT(plan_id,course_id) DO UPDATE SET decided_by=excluded.decided_by,decided_at=excluded.decided_at,reason=excluded.reason`,plan,course,actor.id,at,reason,basis,...authority.params??[]),
   stmt(env,"INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,'cutover.credit_decline',?,? WHERE changes()=1",at,actor.id,plan,JSON.stringify({course,reason}))])
 insist(result[0].meta.changes===1,'cutover_stale',409)
 return {plan,course,declined:true}
}
export async function approveCutover(env:Bindings,actor:Actor,input:Input){
 owner(actor);const plan=input.text('plan'),reason=input.text('reason',{max:1000}),{basis,view}=await comparison(env,actor,plan)
 insist(input.flag('consent'),'cutover_consent_required',409)
 insist(input.text('digest')===view.digest,'cutover_stale',409)
 insist(view.canApprove,'cutover_unresolved',409)
 const id=newId(),at=now(),authority=ownerPredicate(actor)
 const result=await env.DB.batch([stmt(env,`INSERT INTO beam_cutover_approvals(id,plan_id,basis_sha256,approved_by,approved_at,reason)
   SELECT ?,?,?,?,?,? WHERE (${stateSql})=? AND (${authority.sql}) AND ?>unixepoch()*1000`,id,plan,view.digest,actor.id,at,reason,basis,...authority.params??[],view.validUntil),
   stmt(env,"INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,'cutover.approve',?,? WHERE changes()=1",at,actor.id,plan,JSON.stringify({approval:id,digest:view.digest,reason}))])
 insist(result[0].meta.changes===1,'cutover_stale',409)
 return {id,plan,digest:view.digest}
}
