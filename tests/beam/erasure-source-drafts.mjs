import assert from 'node:assert/strict'
import { file } from './harness.mjs'
import { sourceNestedDocx } from './source-nested-fixtures.mjs'
import { scormPackage } from './scorm-fixtures.mjs'

// Source custody enters through Sources and normal draft conversion, never direct D1 edits.
export async function sourceDraftWithdrawalCheck(f) {
  await sourceUploadCustodyCheck()
  const { api, ids, h, cookies } = f
  const source = await api('author','source.create',{title:'Unpublished inspection procedure',reviewer:ids.reviewer,licence:'owned',licenceEvidence:'Employer-authored procedure',provenance:'Original source under a privacy request',file:file('synthetic-beam-30.docx',sourceNestedDocx())})
  const course=await api('author','course.create',{title:'Unpublished equipment inspection',reviewer:ids.reviewer})
  const base=await api('author','course.lesson',{course:course.id,draftVersion:course.draftVersion,title:'Unrelated opening check',body:'Retain this separately authored lesson.',sources:[]})
  const extracted=await api('author',`sources/${source.versionId}/extraction`)
  const convert={course:course.id,draftVersion:base.draftVersion,sourceVersion:source.versionId,lessons:extracted.lessons,reviewed:true,resolvedUncertainties:extracted.uncertainties.map(row=>row.id)}
  const converted=await api('author','source.convert',convert)
  const affected=converted.draft.lessons.find(row=>row.sources.includes(source.versionId))
  const preview=()=>api('owner','erasure.preview',{kind:'source',subject:source.id})
  let current=await preview()
  assert.equal(current.inventory.sourceDrafts.courses[0].id,course.id)
  assert.deepEqual(current.inventory.sourceDrafts.courses[0].lessons.map(row=>row.id),[affected.id])
  assert.deepEqual(current.inventory.sourceDrafts.blocked,[])
  const request={kind:'source',subject:source.id,digest:current.digest,consent:true,justification:'Withdraw the obsolete unpublished source lessons before erasing the original.'}
  await api('owner','erasure.begin',request,409)
  await api('author','erasure.source-drafts.withdraw',request,403)
  await api('owner','erasure.source-drafts.withdraw',{...request,consent:false},409)
  // An unrelated accepted draft save still changes the withdrawal's exact version.
  const changed=await api('author','course.details',{course:course.id,draftVersion:converted.draftVersion,title:'Unpublished equipment inspection — corrected title',summary:'Owner review pending.'})
  await api('owner','erasure.source-drafts.withdraw',request,409)
  const hold=await api('owner','erasure.hold',{kind:'source',subject:source.id,justification:'Preserve source custody while the privacy request is reviewed.'})
  current=await preview()
  await api('owner','erasure.source-drafts.withdraw',{...request,digest:current.digest},409)
  await api('owner','erasure.hold.release',{hold:hold.id,justification:'Review complete; no source hold applies.'})
  current=await preview()
  await api('owner','erasure.source-drafts.withdraw',{...request,digest:current.digest})
  const after=await api('author',`courses/${course.id}`)
  assert.equal(after.draftVersion,changed.draftVersion+1)
  assert.deepEqual(after.draft.lessons,[base.draft.lessons[0]])
  assert.equal(after.publishedRevision,null)
  await api('author','source.convert',{...convert,draftVersion:converted.draftVersion},409)
  current=await preview()
  assert.deepEqual(current.inventory.sourceDrafts.courses,[])
  const job=await api('owner','erasure.begin',{...request,digest:current.digest})
  // Once execution begins, an author cannot recreate the just-withdrawn custody.
  const stale=await h.raw('/api/beam/source.convert',{cookie:cookies.author,body:{...convert,draftVersion:after.draftVersion}})
  assert.ok([404,409].includes(stale.status))
  for(let step=0;step<15;step++) {
    const result=await api('owner','erasure.resume',{job:job.id})
    assert.notEqual(result.state,'failed',result.failure)
    if(result.state==='complete')break
    assert.notEqual(step,14)
  }
  assert.equal((await h.raw(extracted.assets[0].href,{cookie:cookies.author})).status,404)
  assert.equal((await h.raw(extracted.original,{cookie:cookies.author})).status,404)
  await api('author','course.lesson',{course:course.id,draftVersion:after.draftVersion,title:'Stale source citation',body:'Do not re-admit erased material.',sources:[source.versionId]},404)
  assert.deepEqual((await api('author',`courses/${course.id}`)).draft.lessons,after.draft.lessons)
  await api('author','source.version',{source:source.id,provenance:'Refused erased source',file:file('synthetic-beam-34.txt','A different late original.')},404)
  const refusedPackage=await api('author','course.create',{title:'Erased-source package refusal',reviewer:ids.reviewer})
  await api('owner','package.import',{course:refusedPackage.id,draftVersion:refusedPackage.draftVersion,licence:'owned',licenceEvidence:'Original Beam package dedicated to CC0',sources:[source.versionId],file:file('synthetic-beam-35.zip',scormPackage())},409)
  assert.equal((await api('author',`courses/${refusedPackage.id}`)).draftVersion,refusedPackage.draftVersion)
  // Frozen content and package citations remain explicit refusals, never rewritten by this operation.
  const frozenSource=await api('author','source.create',{title:'Frozen procedure custody',reviewer:ids.reviewer,licence:'owned',licenceEvidence:'Employer-authored procedure',provenance:'Retained review original',file:file('synthetic-beam-31.txt','# Retained procedure\nKeep this reviewed source.')})
  const frozenCourse=await api('author','course.create',{title:'Procedure under human review',reviewer:ids.reviewer})
  const frozenDraft=await api('author','course.lesson',{course:frozenCourse.id,draftVersion:frozenCourse.draftVersion,title:'Retained procedure',body:'Keep this reviewed lesson.',sources:[frozenSource.versionId]})
  await api('author','course.submit',{course:frozenCourse.id,draftVersion:frozenDraft.draftVersion})
  const frozen=await api('owner','erasure.preview',{kind:'source',subject:frozenSource.id})
  assert.ok(frozen.inventory.sourceDrafts.blocked.length)
  await api('owner','erasure.source-drafts.withdraw',{...request,subject:frozenSource.id,digest:frozen.digest},409)
  assert.deepEqual((await api('author',`courses/${frozenCourse.id}`)).draft,frozenDraft.draft)
  const packaged=await api('author','course.create',{title:'Source-cited package draft',reviewer:ids.reviewer})
  await api('owner','package.import',{course:packaged.id,draftVersion:packaged.draftVersion,licence:'owned',licenceEvidence:'Original Beam package dedicated to CC0',sources:[frozenSource.versionId],file:file('synthetic-beam-32.zip',scormPackage())})
  const packagePreview=await api('owner','erasure.preview',{kind:'source',subject:frozenSource.id})
  assert.ok(packagePreview.inventory.sourceDrafts.blocked.some(reason=>reason.includes('package')))
  await api('owner','erasure.begin',{...request,subject:frozenSource.id,digest:packagePreview.digest},409)
  return { source, course, kept: after.draft.lessons }
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const { fixture }=await import('./regression-fixture.mjs')
  const f=await fixture()
  try {
    await f.api('owner','erasure.policy',{assessmentDays:0,justification:'Erase only explicitly approved source custody.',consent:true})
    await sourceDraftWithdrawalCheck(f)
    console.log('PASS source draft withdrawal and admission fences')
  } finally { await f.h.close() }
}

// Exercise both orderings at the object-store edge through the real source door.
export async function sourceUploadCustodyCheck(screen) {
  const { fixture } = await import('./regression-fixture.mjs')
  const { createHash } = await import('node:crypto')
  let arm = false, fail = false
  let entered, release
  const waiting = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve=done }); return {promise,resolve} }
  const admissionEntered=deferred(), admissionRelease=deferred(), raceEntered=deferred(), raceRelease=deferred()
  const uploadEntered=deferred(), uploadRelease=deferred()
  let admissionArm=false, raceArm=false, uploadArm=false, starting, racing, lateUpload
  let writes = 0
  const f = await fixture({ sourceUploadAdmissionBarrier: async () => { if (uploadArm) { uploadArm=false; uploadEntered.resolve(); await uploadRelease.promise } }, erasureAdmissionBarrier: async () => { if (admissionArm) { admissionArm=false; admissionEntered.resolve(); await admissionRelease.promise } }, storageWriteBarrier: async (_key, phase) => {
    if (phase==='after') { if (fail) throw new Error('synthetic-beam-storage-interruption'); return }
    writes++
    if (raceArm) { raceArm=false; raceEntered.resolve(); await raceRelease.promise }
    if (arm) { arm = false; entered(); await gate }
  } })
  let uploading
  try {
    const { api, ids, h } = f
    await api('owner','erasure.policy',{assessmentDays:0,justification:'Explicit source custody review.',consent:true})
    const fields = {title:'Source upload custody',reviewer:ids.reviewer,licence:'owned',licenceEvidence:'Employer-authored original',provenance:'Original source'}
    const source = await api('author','source.create',{...fields,file:file('synthetic-beam-36.txt','synthetic-beam-36 original')})
    const preview = () => api('owner','erasure.preview',{kind:'source',subject:source.id})
    const before = await preview()
    const request = {kind:'source',subject:source.id,consent:true,justification:'Erase only after all source writes have settled.'}
    const content = 'synthetic-beam-37 pending version'
    arm = true
    uploading = api('author','source.version',{source:source.id,provenance:'Concurrent source version',file:file('synthetic-beam-37.txt',content)})
    await waiting
    const blocked = await preview()
    assert.equal(blocked.inventory.uploads.length,1)
    assert.ok(blocked.inventory.unsupported.some(reason => reason.includes('unresolved object custody')))
    assert.notEqual(blocked.digest,before.digest)
    if (screen) {
      const { page, width, directory } = screen
      const { join } = await import('node:path')
      await page.context().addCookies(f.cookies.owner.split('; ').map(cookie => { const at=cookie.indexOf('='); return {name:cookie.slice(0,at),value:cookie.slice(at+1),url:h.origin} }))
      await page.goto(`${h.origin}/app/erasure?kind=source&subject=${source.id}`)
      await page.getByText('Cannot execute:',{exact:false}).scrollIntoViewIfNeeded()
      assert.ok(await page.getByText('Source uploads are still in progress or have unresolved object custody.',{exact:false}).isVisible())
      assert.equal(await page.locator('form[action="/app/do/erasure.begin"]').count(),0)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      await page.screenshot({path:join(directory,`${width}-erasure-source-pending-upload.png`)})
    }
    await api('owner','erasure.begin',{...request,digest:before.digest},409)
    await api('owner','erasure.begin',{...request,digest:blocked.digest},409)
    const hold = await api('owner','erasure.hold',{kind:'source',subject:source.id,justification:'Upload review under a hold.'})
    const held = await preview()
    await api('owner','erasure.begin',{...request,digest:held.digest},409)
    await api('owner','erasure.hold.release',{hold:hold.id,justification:'Review complete.'})
    release()
    const version = await uploading
    const fresh = await preview()
    assert.deepEqual(fresh.inventory.uploads,[])
    assert.deepEqual(fresh.inventory.unsupported,[])
    assert.ok(fresh.inventory.fileHashes.includes(version.sha256))
    await api('owner','erasure.begin',{...request,digest:blocked.digest},409)
    // Identical bytes in another live source must survive this source's erasure.
    const shared = await api('author','source.create',{...fields,title:'Shared original custody',file:file('synthetic-beam-38.txt',content)})
    // A version can reserve custody after erasure's own preview but before its
    // admission transaction. The database boundary must still refuse erasure.
    admissionArm=true
    starting=api('owner','erasure.begin',{...request,digest:fresh.digest},409)
    await admissionEntered.promise
    raceArm=true
    racing=api('author','source.version',{source:source.id,provenance:'Upload wins admission race',file:file('synthetic-beam-41.txt','synthetic-beam-41 concurrent bytes')})
    await raceEntered.promise
    admissionRelease.resolve()
    assert.equal((await starting).error,'source_upload_in_progress')
    raceRelease.resolve()
    const racedVersion=await racing
    const ready=await preview()
    assert.ok(ready.inventory.fileHashes.includes(racedVersion.sha256))
    // Reverse the race: upload has read the source, but erasure wins before
    // its durable upload reservation. No bytes may reach storage afterwards.
    uploadArm=true
    lateUpload=api('author','source.version',{source:source.id,provenance:'Erasure wins admission race',file:file('synthetic-beam-42.txt','synthetic-beam-42 late bytes')},409)
    await uploadEntered.promise
    const priorWrites = writes
    const job = await api('owner','erasure.begin',{...request,digest:ready.digest})
    uploadRelease.resolve()
    assert.equal((await lateUpload).error,'source_unavailable')
    assert.equal(writes,priorWrites,'a raced upload reservation is refused before storage')
    await api('author','source.version',{source:source.id,provenance:'Late source upload',file:file('synthetic-beam-39.txt','synthetic-beam-39 late bytes')},404)
    assert.equal(writes,priorWrites,'admitted erasure refuses an upload before any object write')
    let report
    for (let step=0;step<15;step++) {
      report = await api('owner','erasure.resume',{job:job.id})
      assert.notEqual(report.state,'failed',report.failure)
      if(report.state==='complete') break
      assert.notEqual(step,14)
    }
    assert.equal(report.files.find(row=>row.sha256===source.sha256).state,'deleted')
    assert.equal(report.files.find(row=>row.sha256===version.sha256).state,'retained_shared_or_held')
    assert.equal(await h.files.head(`sha256/${source.sha256}`),null)
    assert.ok(await h.files.head(`sha256/${shared.sha256}`))
    const lateHash=createHash('sha256').update('synthetic-beam-39 late bytes').digest('hex')
    assert.equal(await h.files.head(`sha256/${lateHash}`),null)
    assert.equal(await (await h.raw(`/api/beam/source-files/${shared.versionId}`,{cookie:f.cookies.author})).text(),content)
    // A failed write is never silently expired into a successful deletion claim.
    fail = true
    await api('author','source.version',{source:shared.id,provenance:'Interrupted upload',file:file('synthetic-beam-40.txt','synthetic-beam-40 interrupted')},500)
    const unresolved = await api('owner','erasure.preview',{kind:'source',subject:shared.id})
    assert.equal(unresolved.inventory.uploads.length,1)
    const interruptedHash=createHash('sha256').update('synthetic-beam-40 interrupted').digest('hex')
    assert.ok(await h.files.head(`sha256/${interruptedHash}`),'bytes committed before the lost response remain unresolved custody')
    await api('owner','erasure.begin',{...request,subject:shared.id,digest:unresolved.digest},409)
  } finally {
    release()
    admissionRelease.resolve()
    raceRelease.resolve()
    uploadRelease.resolve()
    if (lateUpload) await lateUpload.catch(()=>{})
    if (starting) await starting.catch(()=>{})
    if (racing) await racing.catch(()=>{})
    if (uploading) await uploading.catch(()=>{})
    await f.h.close()
  }
}
