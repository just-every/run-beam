import { sourceErasureBrowserCheck } from './erasure-source-browser.mjs'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'
import { prepareMicrolearning } from './regression-collab.mjs'
const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
const directory = process.env.BEAM_EVIDENCE_DIR || 'test-results'
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain','--password-store=basic'] })
try { for (const width of [1440,390]) {
 const f = await fixture({ businessName:'Sierra Lakes Produce', names:{learner:'Riley Morgan',manager:'Nina Brooks',reviewer:'Sam Taylor',assessor:'Avery Carter'} })
 const context = await browser.newContext({viewport:{width,height:900},ignoreHTTPSErrors:true})
 try {
  await context.addCookies(f.cookies.owner.split('; ').map(cookie=>{const at=cookie.indexOf('=');return{name:cookie.slice(0,at),value:cookie.slice(at+1),url:f.h.origin}}))
  const page=await context.newPage()
  const shot=async(name,locator)=>{if(locator)await locator.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);await page.screenshot({path:join(directory,`${width}-erasure-${name}.png`)})}
  const c=await f.course('Equipment pressure inspection',true), assignment=await f.assign(c)
  await f.lessons(assignment)
  const practical=await f.api('learner','practical.submit',{assignment,evidence:'Gauge reading observed and recorded.',file:file('pressure-reading.txt','Observed gauge evidence')})
  await f.api('assessor','practical.decide',{attempt:practical.id,decision:'accepted',note:'Observed complete procedure.'})
  const sequence=await prepareMicrolearning(f,'erasure browser')
  const revision=(await f.api('author','course.submit',{course:sequence.id,draftVersion:sequence.draftVersion})).id
  await f.publish(revision)
  const practice=await f.assign(sequence), state=await f.api('learner',`sequences/${practice}`)
  await f.api('learner','sequence.answer',{assignment:practice,day:1,choice:1,version:state.version})
  const followOn=await f.course('Follow-on inspection practice')
  const dryRule=await f.api('owner','automation.save',{name:'Inspection follow-on',trigger:'completion',sourceCourse:c.id,targetCourse:followOn.id,dueDays:7})
  await f.api('owner','automation.preview',{rule:dryRule.id})
  await f.api('owner','automation.state',{rule:dryRule.id,state:'active'})
  const proposal=await f.api('manager','agent.propose',{kind:'assignment_plan',title:'Inspection follow-on for Riley',inputs:[{type:'assignment',id:practice}],reasons:['Follow the inspected procedure with supervised practice.'],payload:{items:[{learner:f.ids.learner,course:followOn.id,courseRevision:followOn.revision,dueDate:'2030-10-01',dueTime:'17:00',timezone:'UTC'}]}})
  await page.goto(f.h.origin+'/app/business')
  await shot('settings')
  await page.getByRole('link',{name:'Preview erasure, manage legal holds and inspect deletion reports'}).click()
  const policy=page.locator('form[action="/app/do/erasure.policy"]')
  await policy.getByLabel('Assessment retention after latest assessment (days)').fill('0')
  await policy.getByLabel('Employer justification').fill('Erase personal learning data unless a current investigation requires assessed evidence.')
  await policy.getByRole('checkbox').check()
  await policy.getByRole('button',{name:'Save retention policy'}).click()
  const hold=page.locator('form[action="/app/do/erasure.hold"]').first()
  await hold.getByLabel('Person',{exact:true}).selectOption(f.ids.learner)
  await hold.getByLabel('Legal justification').fill('Open safety investigation; retain assessed inspection evidence.')
  await hold.getByRole('button',{name:'Place person hold'}).click()
  await shot('policy-hold',page.getByRole('heading',{name:'Legal holds',exact:true}))
  await page.getByLabel('Person to erase').selectOption(f.ids.learner)
  await page.getByRole('button',{name:'Preview person erasure'}).click()
  await shot('custody-preview',page.getByRole('heading',{name:'Custody preview: Riley Morgan',exact:true}))
  const withdraw=page.locator('form[action="/app/do/erasure.snapshots.withdraw"]')
  await withdraw.getByLabel('Reason for withdrawing saved dry runs').fill('Withdraw the shared inspection preview for this approved erasure request.')
  await withdraw.getByRole('checkbox').check()
  await shot('shared-dry-run-withdrawal',withdraw)
  await withdraw.getByRole('button',{name:'Withdraw saved dry runs'}).click()
  assert.equal(new URL(page.url()).searchParams.get('error'),null)
  assert.equal((await f.api('owner','automation')).rules.find(row=>row.id===dryRule.id).state,'paused')
  const preparation=page.locator('form[action="/app/do/erasure.proposals.withdraw"]')
  await preparation.getByLabel('Reason for withdrawing saved preparations').fill('Withdraw the unapplied preparation containing Riley’s data.')
  await preparation.getByRole('checkbox').check()
  assert.equal(await page.getByLabel('Person to erase',{exact:true}).inputValue(),f.ids.learner)
  await shot('shared-preparation-withdrawal',preparation)
  await preparation.getByRole('button',{name:'Withdraw saved preparations'}).click()
  assert.equal(new URL(page.url()).searchParams.get('error'),null)
  await f.api('owner',`proposals/${proposal.id}`,undefined,404)
  const start=page.locator('form[action="/app/do/erasure.begin"]')
  await start.getByLabel('Reason for this erasure').fill('Approved person request; retain only held assessed evidence.')
  await start.getByRole('checkbox').check()
  await start.getByRole('button',{name:'Start erasure'}).click()
  await page.waitForURL(/job=/)
  const job=new URL(page.url()).searchParams.get('job')
  await shot('started',page.getByRole('heading',{name:'Deletion report',exact:true}))
  const before=await f.api('owner',`erasure/${job}`)
  await page.reload()
  assert.equal((await f.api('owner',`erasure/${job}`)).phase,before.phase)
  for(let step=0;step<60;step++){
   const report=await f.api('owner',`erasure/${job}`)
   assert.notEqual(report.state,'failed',report.failure)
   if(report.state==='complete')break
   await page.getByRole('button',{name:'Run next erasure step',exact:true}).click()
   assert.notEqual(step,59)
  }
  await shot('held-deletion-report',page.getByRole('heading',{name:'Deletion report',exact:true}))
  const data=await(await f.h.raw('/app/data-export.json',{cookie:f.cookies.owner})).json()
  assert.equal(data.records.beam_sequence_answers.rows.filter(row=>row.assignment_id===practice).length,0)
  assert.ok(data.records.beam_attempts.rows.some(row=>row.id===practical.id))
  assert.ok(data.records.beam_members.rows.some(row=>row.id===f.ids.learner&&row.email===null))
  console.log(`PASS erasure owner policy/hold/preview/execute/resume/report/practice removal ${width}`)
  await sourceErasureBrowserCheck(f,page,width,directory)
 } finally {await context.close();await f.h.close()}
}} finally {await browser.close()}
