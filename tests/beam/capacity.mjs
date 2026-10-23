// Independent scale qualification, intentionally outside push Verify.
// Synthetic documented TalentLMS export; real native Worker, D1/R2 and package runtime.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'
import { workbook, syntheticImage, syntheticAudio, syntheticVideo } from './fixtures.mjs'
import { sourceProcedurePdf } from './source-fixtures.mjs'
import { scormPackage } from './scorm-fixtures.mjs'
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'','qualification requires a clean committed candidate')
const started=Date.now(), steps={}, timed=async(name,run)=>{const at=Date.now();const result=await run();steps[name]=Date.now()-at;console.log(`PASS capacity ${name} (${steps[name]}ms)`);return result}
const f=await fixture({businessName:'Synthetic 200-person employer'})
let browser
try {
  const {api,h,cookies,ids}=f, concurrent=[]
  for(let n=0;n<8;n++){
    const email=`concurrent-${n}@capacity.test`
    const member=await api('owner','person.invite',{email,name:`Concurrent employee ${n}`,roles:['learner']})
    concurrent.push({id:member.id,email,cookie:await h.signIn(email,{requested:true})})
  }
  const baseline=(await api('owner','people')).members
  const roster=['Employee ID,Name,Email,Employment,Location,Job role',...Array.from({length:200-baseline.length},(_,n)=>`synthetic-beam-${n+1000},Employee ${n+1},employee-${n+1}@capacity.test,active,${n%2?'Austin':'Chicago'},Operator`)].join('\n')
  const batch=await timed('roster-preview',()=>api('owner','people.batch.preview',{file:file('capacity-roster.csv',roster),invite:false}))
  assert.equal(batch.rows.length,200-baseline.length)
  await timed('roster-apply',async()=>{for(let n=0;n<10;n++){const applied=await api('owner','people.batch.apply',{batch:batch.id});if(applied.done)return;assert.ok(n<9)}})
  const members=(await api('owner','people')).members
  assert.equal(members.length,200)
  const team=await f.team('All 200 employees',members.map(row=>row.id))
  const c=await api('owner','course.create',{title:'Mixed-media workstation qualification',reviewer:ids.reviewer})
  let version=c.draftVersion
  const lesson=await api('owner','course.lesson',{course:c.id,draftVersion:version,title:'Inspect and record',body:'Inspect the clean tools and record the reading.',sources:[]});version=lesson.draftVersion
  const assets=[]
  for(const [kind,name,bytes] of [['image','station.png',syntheticImage],['audio','station.mp3',syntheticAudio],['video','station.webm',syntheticVideo],['document','procedure.pdf',sourceProcedurePdf()]]){
    const source=await api('owner','source.create',{title:`Workstation ${kind}`,licence:'owned',licenceEvidence:'Employer original',reviewer:ids.reviewer,provenance:'Synthetic capacity fixture',file:file(name,bytes)});assets.push({id:source.versionId,bytes})
    version=(await api('owner','course.block',{course:c.id,draftVersion:version,lesson:lesson.draft.lessons[0].id,content:{kind,source:source.versionId,text:`Workstation ${kind}`}})).draftVersion
  }
  version=(await api('owner','course.question',{course:c.id,draftVersion:version,prompt:'What must be recorded?',choices:'The reading\nNothing',correct:'1'})).draftVersion
  version=(await api('owner','course.assessment',{course:c.id,draftVersion:version,passPercent:100,maxAttempts:2})).draftVersion
  const packaged=await api('owner','package.import',{course:c.id,draftVersion:version,licence:'owned',licenceEvidence:'Original CC0 package',file:file('workstation.zip',scormPackage())});version=packaged.draftVersion
  const revision=(await api('owner','course.submit',{course:c.id,draftVersion:version})).id;await f.publish(revision)
  const assignment=await timed('cohort-enrollment',()=>api('owner','assignment.create',{course:c.id,teams:[team],dueDate:'2030-10-01'}))
  assert.equal(assignment.created.length,200)
  assert.equal((await api('owner','assignment.create',{course:c.id,teams:[team],dueDate:'2030-10-01'})).created.length,0)
  // Two years of retained history, one latest and one earlier completion for every employee.
  const report=workbook([
    ['Users',[['User','Email','Progress','Completion date','Score'],...members.map(row=>[row.name,row.email,'100%','14/03/2025',90])]],
    ['Timeline',[['Date','User','Email','Event'],...members.map(row=>['02/02/2024 09:00',row.name,row.email,'Completed the course'])]],
  ])
  const bytes=Buffer.from(JSON.stringify({courseList:file('courses.csv','ID,Course,Code,Category\n101,Previous workstation program,PREV,Operations\n'),reports:[{course:'101',file:file('course-101.xlsx',report)}],dateFormat:'DMY',mappings:{101:c.id}}))
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
  const imported=async(action,body)=>{const response=await h.fetch(`/api/operator/import/${action}`,{method:'POST',headers:{cookie:cookies.owner,origin:h.origin,'content-type':'application/json','X-Import-Source':'talentlms'},body:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,200,`${action}: ${value.error}`);return value}
  await timed('retained-history',async()=>{
    let uploadId;const chunks=Math.ceil(bytes.length/65536)
    for(let index=0;index<chunks;index++){const chunk=bytes.subarray(index*65536,(index+1)*65536);uploadId=(await imported('uploads',{uploadId,name:'capacity-history.json',bundleSha256:hash(bytes),totalBytes:bytes.length,totalChunks:chunks,index,chunkSha256:hash(chunk),base64:chunk.toString('base64')})).uploadId}
    const plan=await imported('plan',{uploadId});assert.equal(plan.rejected.length,0)
    for(let n=0;n<100;n++){const result=await imported('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(result.job.state==='completed')break;assert.ok(n<99)}
    const history=await api('owner','history');assert.equal(history.filter(row=>row.kind==='completion').length,400);assert.ok(history.filter(row=>row.kind==='completion').every(row=>row.historical))
    assert.equal((await imported('reconcile',{planId:plan.planId})).ok,true)
  })
  await timed('eight-concurrent-learners',()=>Promise.all(concurrent.map(async person=>{
    const record=await h.api('records/me',person.cookie), a=record.assignments.find(row=>row.course===c.id)
    assert.ok(a)
    const view=await h.api(`assignments/${a.id}`,person.cookie)
    await h.api('lesson.complete',person.cookie,{assignment:a.id,lesson:view.lessons[0].id})
    const quiz=await h.api(`assignments/${a.id}`,person.cookie)
    const answers=Object.fromEntries(quiz.quiz.questions.map(row=>[`q_${row.id}`,['0']]))
    await h.api('quiz.submit',person.cookie,{assignment:a.id,...answers})
    const session=await h.api('package.launch',person.cookie,{package:packaged.id,assignment:a.id,sco:'one'})
    const content=await h.raw(`/beam-package/${session.id}/index.html`);assert.equal(content.status,200)
    await h.api('package.runtime',person.cookie,{session:session.id,version:0,event:'terminate',values:{'cmi.core.lesson_status':'passed','cmi.core.score.raw':'100','cmi.core.session_time':'0000:01:00.00'}})
    const completed=await h.api(`assignments/${a.id}`,person.cookie);assert.equal(completed.completion.revision,revision)
    assert.equal((await h.api('records/me',person.cookie)).history.length,2)
    for(const asset of assets)assert.deepEqual(Buffer.from(await(await h.raw(`/api/beam/source-files/${asset.id}`,{cookie:person.cookie})).arrayBuffer()),asset.bytes)
  })))
  const before=await api('owner','operations');assert.equal(before.people,200);assert.equal(before.learning.assignments,200);assert.equal(before.learning.completions,8);assert.equal(before.learning.importedHistory,401)
  // Admission fails before mutation, then a corrected file succeeds without losing prior files or records.
  const tooLarge=file('oversized.txt',Buffer.alloc(25_000_001,120))
  const refused=await api('owner','source.create',{title:'Oversized original',licence:'owned',licenceEvidence:'Employer original',reviewer:ids.reviewer,provenance:'Capacity limit',file:tooLarge},400)
  assert.equal(refused.error,'file_size')
  const after=await api('owner','operations');assert.deepEqual(after.storage,before.storage);assert.deepEqual(after.learning,before.learning)
  await api('owner','source.create',{title:'Corrected bounded original',licence:'owned',licenceEvidence:'Employer original',reviewer:ids.reviewer,provenance:'Corrected original',file:file('corrected.txt','Record the inspection.')})
  const exported=await timed('complete-export',async()=>await(await h.raw('/app/data-export.json',{cookie:cookies.owner})).json())
  assert.equal(exported.records.beam_members.count,200);assert.equal(exported.records.beam_assignments.count,200);assert.equal(exported.records.beam_completions.count,8);assert.equal(exported.records.beam_imported_history.count,401)
  if(process.argv.includes('--browser')){
    const {chromium}=await import(process.env.BEAM_PLAYWRIGHT_MODULE||'@playwright/test');browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
    const evidence=process.env.BEAM_EVIDENCE_DIR||'test-results';await mkdir(evidence,{recursive:true})
    for(const width of [1440,390]){const context=await browser.newContext({viewport:{width,height:900},ignoreHTTPSErrors:true});try{await context.addCookies(cookies.owner.split('; ').map(value=>{const at=value.indexOf('=');return{name:value.slice(0,at),value:value.slice(at+1),url:h.origin}}));const page=await context.newPage();await page.goto(h.origin+'/app/business');await page.getByRole('heading',{name:'Installation health',exact:true}).waitFor();assert.ok((await page.locator('main').innerText()).includes('200 active people'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(evidence,`${width}-capacity-health.png`),fullPage:true})}finally{await context.close()}}
  }
  const receipt={head,run:process.env.BEAM_CAPACITY_RUN_ID||`cloud-capacity-${new Date(started).toISOString().replace(/[:.]/g,'-')}`,activePeople:200,enrollments:200,retainedCompletions:400,concurrentLearners:8,nativeCompletions:8,steps,elapsedMs:Date.now()-started,qualification:'Synthetic local built Worker; no hosted SLA or independent provider capacity qualification'}
  if(process.env.BEAM_EVIDENCE_DIR){await mkdir(process.env.BEAM_EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.BEAM_EVIDENCE_DIR,'capacity.json'),JSON.stringify(receipt,null,2)+'\n')}
  console.log('PASS OPS-008 capacity',JSON.stringify(receipt))
}finally{if(browser)await browser.close();await f.h.close()}
