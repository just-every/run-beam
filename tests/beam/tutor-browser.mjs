import assert from 'node:assert/strict'
export async function tutorBrowser(f,pages) {
 const {chromium} = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
 const {mkdir} = await import('node:fs/promises')
 const evidence = process.env.BEAM_EVIDENCE_DIR
 assert.ok(evidence,'Browser evidence must be outside the product checkout')
 await mkdir(evidence,{recursive:true})
 const browser = await chromium.launch({...(process.env.BEAM_BROWSER_EXECUTABLE ? {executablePath:process.env.BEAM_BROWSER_EXECUTABLE} : {}),headless:true,args:['--no-sandbox','--use-mock-keychain','--password-store=basic','--ignore-certificate-errors']})
 try {
  for(const width of [1440,390]) for(const [name,role,path,heading] of pages) {
   const context = await browser.newContext({viewport:{width,height:900},ignoreHTTPSErrors:true})
   try {
    await context.addCookies(f.cookies[role].split('; ').map(pair=>({name:pair.slice(0,pair.indexOf('=')),value:pair.slice(pair.indexOf('=')+1),url:f.h.origin})))
    const page = await context.newPage();await page.goto(f.h.origin+path)
    await page.getByRole('heading',{name:heading,exact:true}).first().waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} fits ${width}`)
    const icons = page.locator('a[aria-label],button[aria-label],summary[aria-label]')
    for(let index=0;index<await icons.count();index++) {
     const control = icons.nth(index)
     if((await control.innerText()).trim()) continue
     assert.ok(await control.getAttribute('data-tooltip'),'Icon-only control has a tooltip')
     await control.focus()
     assert.equal(await control.evaluate(el=>getComputedStyle(el,'::after').visibility),'visible','Tooltip is immediate on keyboard focus')
     await control.blur();await control.hover();await page.waitForTimeout(350)
     assert.equal(await control.evaluate(el=>getComputedStyle(el,'::after').visibility),'visible','Tooltip appears after hover delay')
     const tip = await control.getAttribute('data-tooltip')
     assert.ok(tip.split(/\s+/).length>=2,'Tooltip describes the control')
    }
    if(path==='/app/model-account') {
     const costs = await f.api('owner','costs'), body = await page.locator('body').innerText()
     assert.ok(body.includes(`${(costs.model?.unknownBillingRequests ?? 0)} failed or pending requests retain USD ${((costs.model?.unknownBillingReservedCents ?? 0)/100).toFixed(2)} with unknown billing`),'Rendered unknown billing matches retained reservations')
     assert.ok(body.includes('Estimates are not invoices.') && body.includes('Conservative reservation per request: USD'),'Rendered costs explain estimate limits')
    }
    if(name==='answer') await page.getByText('These exact passages may not cover your circumstances. Ask the responsible expert if unsure.',{exact:true}).waitFor()
    if(name==='ask') {
     const notice = await page.locator('body').innerText()
     assert.ok(notice.includes('sending them to OpenAI') && notice.includes('This question may contain information I supply.'))
    }
    if(['unsupported','partial','conflicting','handoff-disclosure'].includes(name)) await page.getByText('The permitted material does not establish an answer. Ask the responsible expert.',{exact:true}).waitFor()
    if(name==='handoff-disclosure') assert.ok((await page.locator('body').innerText()).includes('course cohort and its responsible experts'))
    await page.screenshot({path:`${evidence}/${width}-tutor-${name}.png`,fullPage:true})
    const complete = page.getByText('Complete outbound request',{exact:true})
    if(await complete.count()) {
     await complete.click()
     const shown = JSON.parse(await complete.locator('..').locator('pre').innerText())
     const id = path.split('/').at(-1).split('?')[0]
     assert.deepEqual(shown,(await f.api('owner',`tutor/${id}/preview`)).outbound,'The owner can inspect the complete actual request')
     await page.screenshot({path:`${evidence}/${width}-tutor-${name}-wire.png`,fullPage:true})
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Complete request fits ${width}`)
    }
   } finally {await context.close()}
  }
 } finally {await browser.close()}
 console.log('PASS tutor browser proof at 1440 and 390',pages.map(p=>p[0]).join(', '))
}

export async function tutorForm(f,role,path,action,fields={},width=390) {
 const {chromium}=await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
 const browser=await chromium.launch({...(process.env.BEAM_BROWSER_EXECUTABLE ? {executablePath:process.env.BEAM_BROWSER_EXECUTABLE} : {}),headless:true,args:['--no-sandbox','--use-mock-keychain','--password-store=basic','--ignore-certificate-errors']})
 try {
  const context=await browser.newContext({viewport:{width,height:900},ignoreHTTPSErrors:true})
  await context.addCookies(f.cookies[role].split('; ').map(pair=>({name:pair.slice(0,pair.indexOf('=')),value:pair.slice(pair.indexOf('=')+1),url:f.h.origin})))
  const page=await context.newPage();await page.goto(f.h.origin+path)
  let form=page.locator(`form[action="/app/do/${action}"]`)
  if(action==='tutor.source') form=form.filter({has:page.locator('input[name="rightsConfirmed"]')})
  for(const [name,value] of Object.entries(fields)) {
   const control = form.locator(`[name="${name}"]`)
   if(await control.evaluate(el=>el.tagName==='SELECT')) await control.selectOption(value)
   else await control.fill(value)
  }
  if(await form.getByRole('checkbox').count()) await form.getByRole('checkbox').check()
  await Promise.all([page.waitForNavigation({waitUntil:'load',timeout:110000}),form.getByRole('button').click({timeout:110000})])
  const result=new URL(page.url());assert.equal(result.searchParams.get('error'),null,'The real tutor form succeeds')
  return result.pathname.split('/').at(-1)
 } finally {await browser.close()}
}
