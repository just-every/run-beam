import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'
import { courseReport } from './fixtures.mjs'

export async function cutoverCheck({browser=false}={}){
 const f=await fixture()
 try{
  const {api,h,ids,cookies}=f,c=await f.course('Mapped workstation requirement')
  const courseList=file('courses.csv','ID,Course,Code,Category\n101,Workstation requirement,WORK,Operations\n')
  const hash=value=>createHash('sha256').update(value).digest('hex')
  const call=async(action,body,expected=200)=>{const response=await h.fetch(`/api/operator/import/${action}`,{method:'POST',headers:{origin:h.origin,cookie:cookies.owner,'content-type':'application/json','X-Import-Source':'talentlms'},body:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,expected,`${action}: ${value.error}`);return value}
  const until=async(action,body,expected)=>{for(let n=0;n<100;n++){const value=await call(action,body);if(value.job.state===expected)return value;assert.ok(n<99)}}
  const imported=async(requirements,catchup=false)=>{
   const bytes=Buffer.from(JSON.stringify({courseList,reports:[{course:'101',file:file('course-101.xlsx',courseReport({learnerEmail:'learner@example.test'}))}],dateFormat:'DMY',mappings:{101:c.id},...(requirements?{activeRequirements:file('current-requirements.csv',requirements)}:{})}))
   let uploadId;const chunks=Math.ceil(bytes.length/65536)
   for(let index=0;index<chunks;index++){const chunk=bytes.subarray(index*65536,(index+1)*65536);uploadId=(await call('uploads',{uploadId,name:'cutover.json',bundleSha256:hash(bytes),totalBytes:bytes.length,totalChunks:chunks,index,chunkSha256:hash(chunk),base64:chunk.toString('base64')})).uploadId}
   const plan=await call('plan',{uploadId,catchup});return plan
  }
  const basic=await imported();await until('apply',{planId:basic.planId,reviewedFingerprint:basic.fingerprint},'completed')
  const empty=await api('owner',`cutover/${basic.planId}`)
  assert.equal(empty.canApprove,false);assert.match(empty.gaps[0],/No employer-reviewed/)
  await until('undo',{planId:basic.planId},'undone')
  const wrong=await imported('Email,Course ID,Active,Due date,Unsupported field\nlearner@example.test,101,true,01/10/2030,Retained in original\nunmatched@cutover.test,101,true,01/10/2030,Retained in original\n')
  assert.equal(wrong.rejected.length,1,'unrelated invalid historical date remains named by the original parser')
  await until('apply',{planId:wrong.planId,reviewedFingerprint:wrong.fingerprint},'completed')
  const unresolved=await api('owner',`cutover/${wrong.planId}`)
  assert.equal(unresolved.canApprove,false);assert.equal(unresolved.counts.unmatched,1)
  assert.ok(unresolved.rows.every(row=>row.issues.some(issue=>issue.includes('Unsupported source fields'))))
  await api('manager',`cutover/${wrong.planId}`,undefined,403)
  await api('owner','cutover.approve',{plan:wrong.planId,digest:unresolved.digest,reason:'Reviewed',consent:true},409)
  // Resolve the unmatched person through People, then catch up the immutable original bundle with reviewed columns.
  const joined=await api('owner','person.invite',{email:'unmatched@cutover.test',name:'Resolved employee',roles:['learner']})
  await h.signIn('unmatched@cutover.test',{requested:true})
  const corrected=await imported('Email,Course ID,Active,Due date\nlearner@example.test,101,true,01/10/2030\nunmatched@cutover.test,101,true,01/10/2030\n',true)
  await until('apply',{planId:corrected.planId,reviewedFingerprint:corrected.fingerprint},'completed')
  const snapshot=await api('owner','history')
  const replay=await until('apply',{planId:corrected.planId,reviewedFingerprint:corrected.fingerprint},'completed')
  assert.equal(replay.job.state,'completed');assert.deepEqual(await api('owner','history'),snapshot)
  await api('owner',`cutover/${wrong.planId}`,undefined,409)
  const enrollment=await api('owner','assignment.create',{course:c.id,learners:[ids.learner,joined.id],dueDate:'2030-10-01'})
  assert.equal(enrollment.created.length,2)
  const waiting=await api('owner',`cutover/${corrected.planId}`)
  assert.ok(waiting.rows.every(row=>row.creditDecision==='pending'))
  await api('manager','cutover.credit.decline',{plan:corrected.planId,course:c.id,digest:waiting.digest,reason:'Do not use history'},403)
  await api('owner','cutover.credit.decline',{plan:corrected.planId,course:c.id,digest:'altered',reason:'Do not use history'},409)
  assert.equal((await h.submit('cutover.credit.decline',cookies.owner,{plan:corrected.planId,course:c.id,digest:waiting.digest,reason:'Employer declines using imported history for this requirement'},`/app/import/cutover/${corrected.planId}`)).searchParams.get('error'),null)
  const ready=await api('owner',`cutover/${corrected.planId}`)
  assert.equal(ready.canApprove,true,JSON.stringify({gaps:ready.gaps,rows:ready.rows.map(row=>({issues:row.issues,creditDecision:row.creditDecision}))}));assert.equal(ready.counts.differences,0);assert.equal(ready.counts.active,2)
  assert.deepEqual(await api('owner','history'),snapshot,'shadow and credit decline never rewrite imported history')
  const before=(await api('owner','operations')).learning
  await api('owner','cutover.approve',{plan:corrected.planId,digest:ready.digest,reason:'Compare current requirements',consent:false},409)
  const approved=await api('owner','cutover.approve',{plan:corrected.planId,digest:ready.digest,reason:'Compare current requirements',consent:true})
  assert.equal((await api('owner',`cutover/${corrected.planId}`)).approval.id,approved.id)
  assert.deepEqual((await api('owner','operations')).learning,before,'approval creates neither enrollment nor completion')
  if(browser)await (await import('./cutover-browser.mjs')).cutoverBrowserCheck(f,corrected.planId,c.id)
  await api('owner','person.directory',{member:ids.learner,email:'changed@cutover.test'})
  const identityChanged=await api('owner',`cutover/${corrected.planId}`)
  assert.equal(identityChanged.canApprove,false)
  assert.equal(identityChanged.approval,null)
  assert.ok(identityChanged.rows.some(row=>row.issues.some(issue=>issue.includes('Source email differs'))))
  await api('owner','person.directory',{member:ids.learner,email:'learner@example.test'})
  const next=(await api('owner',`cutover/${corrected.planId}`)).digest
  await api('owner','assignment.due',{assignment:enrollment.created[0],dueDate:'2030-10-02',dueTime:'17:00',timezone:'UTC',reason:'Owner-approved schedule change'})
  await api('owner','cutover.approve',{plan:corrected.planId,digest:next,reason:'Stale comparison',consent:true},409)
  const stale=await api('owner',`cutover/${corrected.planId}`);assert.equal(stale.approval,null);assert.equal(stale.canApprove,false)
  const edited=(await api('owner','history')).find(row=>row.kind==='completion'&&row.member===ids.learner)
  await api('owner','history.accept',{history:edited.id,note:'Employer checked the original record'})
  await until('undo',{planId:corrected.planId},'undone')
  const retained=(await api('owner','history')).find(row=>row.id===edited.id)
  assert.equal(retained.accepted.note,'Employer checked the original record')
  assert.equal((await api('owner','operations')).learning.assignments,before.assignments)
  await api('owner',`cutover/${corrected.planId}`,undefined,409)
 }finally{await f.h.close()}
}
