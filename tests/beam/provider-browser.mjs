import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'
import { sourceProcedurePdf } from './source-fixtures.mjs'
import { sourceOcrProviderResponse } from './source-ocr-fixtures.mjs'

/** Settings and actual provider-job refusal/recovery through the built pages. */
export async function providerControlBrowserCheck() {
  let calls = 0
  console.log('Provider browser: create isolated installation')
  const f = await fixture({outboundService: async request => {
    if (request.url !== 'https://api.openai.com/v1/responses') return null
    calls++
    return Response.json(sourceOcrProviderResponse())
  }})
  console.log('Provider browser: installation ready')
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence,{recursive:true})
  const browser = await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:900},ignoreHTTPSErrors:true,hasTouch:width===390})
      try {
        await context.addCookies(f.cookies.owner.split('; ').map(value => {const at=value.indexOf('=');return {name:value.slice(0,at),value:value.slice(at+1),url:f.h.origin}}))
        const page = await context.newPage()
        const shot = async name => {
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,`provider ${name}: no overflow at ${width}`)
          // Every control on these screens has visible words, including rail/menu/back.
          const iconOnly = await page.locator('a,button,summary,label[for="menu-toggle"]').evaluateAll(nodes => nodes.filter(node => node.querySelector('svg') && !node.textContent.trim()).length)
          assert.equal(iconOnly,0,'changed screens contain no icon-only controls without tooltips')
          await page.screenshot({path:join(evidence,`${width}-provider-${name}.png`),fullPage:true})
        }
        const activate = async control => {
          const action=async()=>{if(width===390)await control.tap();else{await control.focus();await page.keyboard.press('Enter')}}
          await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),action()])
        }
        const accountForm = operation => page.locator('form[action="/app/do/source.ocr.configure"]').filter({has:page.locator(`input[name="operation"][value="${operation}"]`)})
        const configure = async (operation,budget) => {
          const form=accountForm(operation)
          await form.getByLabel('Account mode (your declared OpenAI project)',{exact:true}).selectOption('sandbox')
          await form.getByLabel('Total retained request budget (USD cents)',{exact:true}).fill(String(budget))
          const key=form.locator('input[name="apiKey"]')
          if(operation==='rotate'||!await f.api('owner','source-ocr').then(row=>row.hasKey))await key.fill('synthetic-beam-1003')
          for(const check of await form.getByRole('checkbox').all())await check.check()
          await activate(form.getByRole('button'))
          await page.waitForURL(url=>url.pathname==='/app/sources/ocr'&&url.searchParams.has('notice'))
          assert.equal(new URL(page.url()).searchParams.get('error'),null)
        }
        await page.goto(f.h.origin+'/app/business')
        await shot('settings')
        await activate(page.getByRole('link',{name:'Configure the OCR provider account and USD budget',exact:true}))
        await configure('enable',0)
        await shot('sandbox-zero-budget')
        const source=await f.api('author','source.create',{title:`Budget-controlled scan ${width}`,reviewer:f.ids.reviewer,licence:'owned',licenceEvidence:'Employer original',provenance:'Synthetic scan',file:file('scan.pdf',sourceProcedurePdf(true))})
        await page.goto(`${f.h.origin}/app/sources/${source.versionId}/ocr`)
        await page.getByRole('checkbox').check()
        const previous=calls
        await activate(page.getByRole('button',{name:'Approve and send this PDF for OCR',exact:true}))
        await page.waitForURL(url=>url.searchParams.get('error')==='source_ocr_budget_exhausted')
        assert.equal(calls,previous)
        await page.getByRole('alert').filter({hasText:'No provider call was made'}).waitFor()
        await shot('refused-job')
        await page.goto(f.h.origin+'/app/sources/ocr')
        await shot('refusal-history')
        const config=await f.api('owner','source-ocr')
        await configure('rotate',config.reservedEstimateCents+config.estimateCents)
        await shot('rotated-disabled')
        await configure('enable',config.reservedEstimateCents+config.estimateCents)
        await page.goto(`${f.h.origin}/app/sources/${source.versionId}/ocr`)
        await page.getByRole('checkbox').check()
        await activate(page.getByRole('button',{name:'Approve and send this PDF for OCR',exact:true}))
        await page.waitForURL(url=>url.searchParams.has('notice'))
        assert.equal(calls,previous+1)
        await page.goto(f.h.origin+'/app/sources/ocr')
        await shot('recovered-job')
        await activate(accountForm('revoke').getByRole('button'))
        await page.waitForURL(url=>url.searchParams.has('notice'))
        assert.equal((await f.api('owner','source-ocr')).hasKey,false)
        await shot('revoked')
      } finally {await context.close()}
    }
  } finally {await browser.close();await f.h.close()}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {await providerControlBrowserCheck();console.log('PASS provider Settings browser 1440/390')}
