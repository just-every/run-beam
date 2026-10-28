import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
export async function cutoverBrowserCheck(f,plan,course){
 const {chromium}=await import(process.env.BEAM_PLAYWRIGHT_MODULE||'@playwright/test'),evidence=process.env.BEAM_EVIDENCE_DIR||'test-results'
 await mkdir(evidence,{recursive:true})
 const browser=await chromium.launch({headless:true,executablePath:process.env.BEAM_BROWSER_EXECUTABLE,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try{for(const width of [1440]){
  const context=await browser.newContext({viewport:{width,height:900},ignoreHTTPSErrors:true})
  try{
   await context.addCookies(f.cookies.owner.split('; ').map(value=>{const at=value.indexOf('=');return{name:value.slice(0,at),value:value.slice(at+1),url:f.h.origin}}))
   const page=await context.newPage(),link=`/app/import/cutover/${plan}`
   await page.goto(f.h.origin+'/app/import')
   assert.equal(await page.locator('input[name="activeRequirements"]').count(),1)
   assert.equal(await page.locator('a').filter({hasText:'Review current-requirement shadow'}).count()>0,true)
   const shot=async name=>{
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'cutover overflow')
    for(const proofWidth of [1440,390]){
     await page.setViewportSize({width:proofWidth,height:900})
     await page.screenshot({path:join(evidence,`${proofWidth}-cutover-${name}.png`),fullPage:true})
    }
    await page.setViewportSize({width,height:900})
   }
   await shot('import-sidecar')
   await page.goto(f.h.origin+link)
   await page.getByRole('heading',{name:'Current-requirement shadow',exact:true}).waitFor()
   await shot('approved-shadow')
   const form=page.locator('form[action="/app/do/cutover.approve"]')
   await form.getByLabel('Review reason',{exact:true}).fill('Owner reviewed the current requirement comparison')
   await form.getByRole('checkbox').check()
   await Promise.all([page.waitForNavigation(),form.getByRole('button').click()])
   assert.equal(new URL(page.url()).searchParams.get('error'),null)
   await shot('human-approval')
  }finally{await context.close()}
 }}finally{await browser.close()}
}
