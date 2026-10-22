// Exact-candidate OCR qualification; requires explicit held-key injection and runs outside push Verify.
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'
assert.equal(process.env.BEAM_LIVE_PROOF, '1', 'Live OCR needs explicit qualification mode')
assert.ok(process.env.BEAM_OCR_KEY, 'Inject only the held OCR key through _od08-env.py')
let calls = 0
const f = await fixture({ businessName:'Sierra Lakes Produce', outboundService: async request => {
 if (request.url !== 'https://api.openai.com/v1/responses') return null
 calls++
 const response = await fetch(request.url,{method:'POST',headers:request.headers,body:new Uint8Array(await request.arrayBuffer()),redirect:'error',signal:AbortSignal.timeout(90000)})
 if (!response.ok) {
  const error = (await response.clone().json().catch(()=>({}))).error ?? {}
  const params = new Set(['model','input','service_tier','reasoning.effort','max_output_tokens','text.format.schema'])
  const codes = new Set(['model_not_found','insufficient_quota','invalid_api_key','unsupported_parameter','invalid_value','rate_limit_exceeded','invalid_json_schema'])
  console.log('OCR provider refusal', JSON.stringify({status:response.status,param:params.has(error.param)?error.param:'other',code:codes.has(error.code)?error.code:'other'}))
 }
 return response
}})
let browser
try {
 const { api, h, ids, cookies }=f
 const bytes=await readFile(new URL('./fixtures/synthetic-beam-scan.pdf',import.meta.url))
 const source=await api('author','source.create',{title:'Opening the work area — scanned original',reviewer:ids.reviewer,licence:'owned',licenceEvidence:'Original CC0 procedure created for Beam qualification',provenance:'Image-only original scan',file:file('synthetic-beam-scan.pdf',bytes)})
 const config=await api('owner','source-ocr')
 await api('owner','source.ocr.configure',{operation:'enable',apiKey:process.env.BEAM_OCR_KEY,maxCostCents:config.estimateCents,consent:true})
 const {chromium}=await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
 browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const directory=process.env.BEAM_EVIDENCE_DIR || 'test-results';await mkdir(directory,{recursive:true})
 const contexts=[]
 const open=async(width,role)=>{
  const context=await browser.newContext({viewport:{width,height:900},ignoreHTTPSErrors:true});contexts.push(context)
  await context.addCookies(cookies[role].split('; ').map(cookie=>{const i=cookie.indexOf('=');return{name:cookie.slice(0,i),value:cookie.slice(i+1),url:h.origin}}))
  return context.newPage()
 }
 const shot=async(page,width,name)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);await page.screenshot({path:join(directory,`${width}-ocr-${name}.png`),fullPage:true})}
 try {
  let owner
  for(const width of [1440,390]){
   owner=await open(width,'owner')
   await owner.goto(h.origin+'/app/business');await shot(owner,width,'business-costs')
   await owner.getByRole('link',{name:'OCR account, limits and request history',exact:true}).click();await shot(owner,width,'account')
   await owner.goto(`${h.origin}/app/sources/${source.versionId}/ocr`)
   await owner.getByRole('button',{name:'Approve and send this PDF for OCR',exact:true}).waitFor()
   await shot(owner,width,'source-consent')
  }
  assert.equal(calls,0)
  await owner.getByRole('checkbox').check()
  await owner.getByRole('button',{name:'Approve and send this PDF for OCR',exact:true}).click()
  try { await owner.getByRole('heading',{name:'OCR is ready for author review',exact:true}).waitFor({timeout:100000}) }
  catch (error) {
   console.log('OCR safe outcome',JSON.stringify({calls,runs:(await api('owner','source-ocr')).runs.map(row=>({state:row.state,failure:row.failure}))}))
   await shot(owner,390,'failure')
   throw error
  }
  assert.equal(calls,1)
  const extraction=await api('author',`sources/${source.versionId}/extraction`)
  assert.ok(extraction.lessons.length>0 && !extraction.uncertainties.some(row=>row.requiresOcr))
  const text=extraction.lessons.map(row=>row.body).join('\n')
  assert.match(text,/inspect the work area/i);assert.match(text,/2\s*(?:and|to|–|-)\s*8/i)
  const corrected='Inspect the work area before starting.\n\nKeep the probe between 2 and 8 degrees.\n\nRecord the reading before closing.'
  for(const width of [1440,390]){
   const course=await api('author','course.create',{title:`Reviewed scanned procedure ${width}`,reviewer:ids.reviewer})
   const author=await open(width,'author')
   await author.goto(`${h.origin}/app/sources/${source.versionId}/prepare?course=${course.id}`)
   await author.getByLabel('Lesson title',{exact:true}).first().fill('Opening the work area')
   await author.getByLabel('Lesson text',{exact:true}).first().fill(corrected)
   for(const checkbox of await author.locator('input[name="resolvedUncertainties"]').all())await checkbox.check()
   await author.getByLabel('I compared the extracted lessons',{exact:false}).check()
   await shot(author,width,'original-and-correction')
   await author.getByRole('button',{name:'Add reviewed lessons to draft',exact:true}).click()
   await author.waitForURL(url => url.pathname === `/app/courses/${course.id}`)
   assert.equal(new URL(author.url()).searchParams.get('error'),null)
   await shot(author,width,'draft-editor')
   await author.getByRole('button',{name:'Submit for review',exact:true}).click()
   const revision=(await api('author',`courses/${course.id}`)).revisions.find(row=>row.state==='in_review').id
   const reviewer=await open(width,'reviewer')
   await reviewer.goto(`${h.origin}/app/revisions/${revision}`);await shot(reviewer,width,'human-review')
   await reviewer.getByRole('button',{name:'Publish this revision',exact:true}).click()
   const assigned=await f.assign(course), content=await f.view(assigned), learner=await open(width,'learner')
   await learner.goto(`${h.origin}/app/learn/${assigned}/lessons/${content.lessons[0].id}`)
   assert.ok((await learner.locator('main').innerText()).includes('Record the reading before closing.'))
   await shot(learner,width,'published-learner')
   assert.deepEqual(Buffer.from(await(await h.raw(`/api/beam/source-files/${source.versionId}`,{cookie:cookies.author})).arrayBuffer()),bytes)
  }
  const completed=(await api('owner','source-ocr')).runs.find(row=>row.state==='completed')
  assert.ok(completed.provider_response_id && completed.usage)
  console.log('PASS actual OCR and human correction/publication',JSON.stringify({candidate:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),model:completed.model,providerResponseId:completed.provider_response_id,sourceDigest:completed.sha256,pages:extraction.lessons.length,usage:completed.usage,providerCalls:calls}))
 } finally {for(const context of contexts)await context.close()}
 await api('owner','source.ocr.configure',{operation:'revoke'})
} finally {if(browser)await browser.close();await f.h.close()}
