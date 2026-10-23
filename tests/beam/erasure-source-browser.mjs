import assert from 'node:assert/strict'
import { join } from 'node:path'
import { file } from './harness.mjs'

export async function sourceErasureBrowserCheck(f, page, width, directory) {
  const source=await f.api('author','source.create',{title:'Obsolete packing station draft',reviewer:f.ids.reviewer,licence:'owned',licenceEvidence:'Employer-authored procedure',provenance:'Unpublished packing instructions',file:file('synthetic-beam-33.txt','# Set up the packing station\nCheck the clean tray before packing.')})
  const course=await f.api('author','course.create',{title:'Packing station preparation',reviewer:f.ids.reviewer})
  const base=await f.api('author','course.lesson',{course:course.id,draftVersion:course.draftVersion,title:'Keep the work area clear',body:'This separately authored lesson remains available.',sources:[]})
  const extraction=await f.api('author',`sources/${source.versionId}/extraction`)
  await f.api('author','source.convert',{course:course.id,draftVersion:base.draftVersion,sourceVersion:source.versionId,lessons:extraction.lessons,reviewed:true})
  await page.goto(`${f.h.origin}/app/erasure?kind=source&subject=${source.id}`)
  const shot=async name=>{
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await page.screenshot({path:join(directory,`${width}-erasure-source-${name}.png`)})
  }
  const withdraw=page.locator('form[action="/app/do/erasure.source-drafts.withdraw"]')
  await withdraw.getByLabel('Reason for withdrawing unpublished source lessons').fill('Withdraw obsolete source-derived lessons before deleting the original procedure.')
  await withdraw.getByRole('checkbox').check()
  await withdraw.scrollIntoViewIfNeeded()
  assert.equal(await page.getByLabel('Source to erase',{exact:true}).inputValue(),source.id)
  await shot('draft-withdrawal')
  await withdraw.getByRole('button',{name:'Withdraw unpublished source lessons',exact:true}).click()
  assert.equal(new URL(page.url()).searchParams.get('error'),null)
  const after=await f.api('author',`courses/${course.id}`)
  assert.deepEqual(after.draft.lessons,base.draft.lessons)
  assert.equal(await page.locator('form[action="/app/do/erasure.source-drafts.withdraw"]').count(),0)
  const start=page.locator('form[action="/app/do/erasure.begin"]')
  await start.getByLabel('Reason for this erasure').fill('Approved erasure of the obsolete unpublished source.')
  await start.getByRole('checkbox').check()
  await start.scrollIntoViewIfNeeded()
  await shot('ready-to-erase')
  await start.getByRole('button',{name:'Start erasure',exact:true}).click()
  const job=new URL(page.url()).searchParams.get('job')
  for(let step=0;step<15;step++) {
    const report=await f.api('owner',`erasure/${job}`)
    assert.notEqual(report.state,'failed',report.failure)
    if(report.state==='complete')break
    await page.getByRole('button',{name:'Run next erasure step',exact:true}).click()
    assert.notEqual(step,14)
  }
  await page.getByRole('heading',{name:'Deletion report',exact:true}).scrollIntoViewIfNeeded()
  await shot('deleted-report')
  assert.equal((await f.h.raw(extraction.original,{cookie:f.cookies.author})).status,404)
  console.log(`PASS source draft withdrawal, fresh erasure and preserved unrelated lesson ${width}`)
}
