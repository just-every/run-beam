// Web qualification only: automated WCAG checks and real keyboard completion are not a screen-reader receipt.
import assert from 'node:assert/strict'
import { mkdir,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { fixture } from './regression-fixture.mjs'

export async function accessibilityBrowserCheck(){
 const f=await fixture(),{chromium}=await import(process.env.BEAM_PLAYWRIGHT_MODULE||'@playwright/test')
 const evidence=process.env.BEAM_EVIDENCE_DIR||'test-results';await mkdir(evidence,{recursive:true})
 const browser=await chromium.launch({headless:true,executablePath:process.env.BEAM_BROWSER_EXECUTABLE,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']}),audits=[]
 try{for(const width of [1440]){
  const context=await browser.newContext({viewport:{width,height:900},ignoreHTTPSErrors:true,reducedMotion:'reduce'})
  try{
   const page=await context.newPage()
   const as=async role=>{await context.clearCookies();await context.addCookies(f.cookies[role].split('; ').map(value=>{const at=value.indexOf('=');return{name:value.slice(0,at),value:value.slice(at+1),url:f.h.origin}}))}
   const tabTo=async locator=>{assert.equal(await locator.count(),1);for(let n=0;n<250;n++){if(await locator.evaluate(node=>node===document.activeElement))return;await page.keyboard.press('Tab')}assert.fail('Keyboard focus did not reach the named control')}
   const activate=async(locator,{navigate=true,space=false}={})=>{await tabTo(locator);const key=space?'Space':'Enter';if(navigate)await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.keyboard.press(key)]);else await page.keyboard.press(key)}
   const shot=async name=>{
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} overflow`)
    for(const proofWidth of [1440,390]){
     await page.setViewportSize({width:proofWidth,height:900})
     await page.screenshot({path:join(evidence,`${proofWidth}-accessibility-${name}.png`),fullPage:true})
    }
    await page.setViewportSize({width,height:900})
   }
   const audit=async name=>{
    const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze()
    audits.push({width,screen:name,violations:result.violations.map(row=>({id:row.id,impact:row.impact,help:row.help,nodes:row.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})),incomplete:result.incomplete.map(row=>({id:row.id,help:row.help}))})
    const tree=await page.locator('main').ariaSnapshot();assert.ok(tree.includes('heading')&&tree.includes('level=1'),'named main heading reaches the accessibility tree')
    await shot(name)
    await writeFile(join(evidence,'accessibility-progress.json'),JSON.stringify({audits},null,2)+'\n')
   }
   const c=await f.api('author','course.create',{title:`Accessible workstation inspection ${width}`,reviewer:f.ids.reviewer})
   let version=(await f.api('author','course.lesson',{course:c.id,draftVersion:1,title:'Inspect the station',body:'Inspect clean tools. Record the reading before use.',sources:[]})).draftVersion
   version=(await f.api('author','course.question',{course:c.id,draftVersion:version,prompt:'What must be recorded?',choices:'The reading\nNothing',correct:'1'})).draftVersion
   version=(await f.api('author','course.assessment',{course:c.id,draftVersion:version,passPercent:100,maxAttempts:2,timeLimitMinutes:10,practicalInstructions:'Demonstrate the inspection and upload the record.',assessor:f.ids.assessor})).draftVersion
   await as('author');await page.goto(`${f.h.origin}/app/courses/${c.id}`);await audit('authoring')
   const revision=(await f.api('author','course.submit',{course:c.id,draftVersion:version})).id
   await as('reviewer');await page.goto(`${f.h.origin}/app/revisions/${revision}`);await audit('review')
   await activate(page.getByRole('button',{name:'Publish this revision',exact:true}))
   assert.equal((await f.api('reviewer',`revisions/${revision}`)).revision.state,'published')
   const assignment=await f.assign(c)
   await as('learner');await page.goto(f.h.origin+'/app/learning');await audit('extra-time-request')
   await activate(page.getByRole('button',{name:'Send extra-time request',exact:true}))
   const request=(await f.api('learner','accommodation-requests')).find(row=>row.assignment===assignment)
   assert.equal(request.state,'pending')
   await as('owner');await page.goto(f.h.origin+'/app/business');await audit('extra-time-review')
   const decision=page.locator('form[action="/app/do/accommodation.decide"]').filter({has:page.locator(`input[name="request"][value="${request.id}"]`)})
   await activate(decision.getByRole('button',{name:'Record decision',exact:true}))
   assert.equal((await f.api('learner','accommodation-requests')).find(row=>row.id===request.id).state,'approved')
   await as('learner');await page.goto(f.h.origin+'/app/learning')
   await page.keyboard.press('Tab');assert.equal(await page.getByRole('link',{name:'Skip to content',exact:true}).evaluate(node=>node===document.activeElement),true)
   await shot('skip-link-focus')
   {await page.setViewportSize({width:390,height:900});const menu=page.getByRole('checkbox',{name:'Menu',exact:true});await activate(menu,{navigate:false,space:true});assert.equal(await menu.isChecked(),true);assert.equal(await page.getByRole('navigation',{name:'Main',exact:true}).isVisible(),true);await shot('menu-focus');await page.keyboard.press('Space');assert.equal(await menu.isChecked(),false);await page.setViewportSize({width,height:900})}
   await activate(page.getByRole('link',{name:'Skip to content',exact:true}))
   assert.equal(await page.locator('main').evaluate(node=>node===document.activeElement),true)
   await audit('learning')
   await activate(page.getByRole('link',{name:new RegExp(`^Accessible workstation inspection ${width}`)}))
   await audit('assignment')
   await activate(page.getByRole('link',{name:'Start',exact:true}))
   await page.locator('[data-save-enhanced=true]').waitFor();await audit('lesson')
   await activate(page.getByRole('button',{name:'Mark done',exact:true}),{navigate:false})
   await page.locator('[data-save-status]').filter({hasText:/^Saved on Beam\.$/}).waitFor()
   await activate(page.locator('[data-save-continue]'))
   await activate(page.getByRole('link',{name:'Take the quiz',exact:true}))
   await audit('timed-start')
   assert.ok((await page.locator('main').innerText()).includes('50% extra time'))
   await activate(page.getByRole('button',{name:'Start the timed quiz',exact:true}));await audit('timed-quiz')
   const session=(await f.view(assignment)).quiz.session;assert.equal(session.deadline-session.startedAt,15*60_000,'recorded 50% accommodation provides a 15-minute deadline')
   const radio=page.getByLabel('The reading',{exact:true});await activate(radio,{navigate:false,space:true});assert.equal(await radio.isChecked(),true)
   await activate(page.getByRole('button',{name:'Submit answers',exact:true}))
   await activate(page.getByRole('link',{name:'Submit evidence',exact:true}));await audit('practical')
   await tabTo(page.getByLabel('What you did',{exact:true}));await page.keyboard.type('I inspected the station and recorded the reading.')
   // Browser file selection is supplied as an original fixture; all page actions stay keyboard-driven.
   await page.getByLabel('Evidence file (optional)',{exact:true}).setInputFiles({name:'inspection.txt',mimeType:'text/plain',buffer:Buffer.from('Observed workstation inspection record.')})
   await activate(page.getByRole('button',{name:'Submit for assessment',exact:true}),{navigate:false})
   await page.locator('[data-save-status]').filter({hasText:/^Saved on Beam\.$/}).waitFor();await activate(page.locator('[data-save-continue]'))
   const attempt=(await f.view(assignment)).attempts.find(row=>row.kind==='practical')
   await f.api('assessor','practical.decide',{attempt:attempt.id,decision:'accepted',note:'Observed safe inspection'})
   await page.reload();await audit('completed-assignment')
   await activate(page.getByRole('link',{name:'Certificate',exact:true}));await audit('certificate')
   const download=page.getByRole('link',{name:'Download PDF',exact:true});await tabTo(download)
   const [receipt]=await Promise.all([page.waitForEvent('download'),page.keyboard.press('Enter')]);assert.equal(await receipt.failure(),null)
   assert.match(await download.getAttribute('href'),/\.pdf$/)
   assert.equal((await f.api('learner','records/me')).completions.filter(row=>row.course===c.id).length,1)
   console.log(`PASS LEARN-011 keyboard lesson/quiz/evidence/certificate and named accessibility tree ${width}`)
  }finally{await context.close()}
 }}finally{await browser.close();await f.h.close()}
 const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),qualification:'Automated WCAG 2.2 AA checks plus keyboard and accessibility-tree assertions; real screen-reader/native/package-equivalence assessment remains required',audits}
 await writeFile(join(evidence,'accessibility.json'),JSON.stringify(report,null,2)+'\n')
 const violations=audits.flatMap(row=>row.violations.map(violation=>({width:row.width,screen:row.screen,...violation})))
 assert.deepEqual(violations,[],'automated WCAG violations remain; inspect accessibility.json')
 console.log('PASS automated WCAG 2.2 AA rules on authoring, review and native learner screens at 1440/390')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await accessibilityBrowserCheck()
