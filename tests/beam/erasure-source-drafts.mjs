import assert from 'node:assert/strict'
import { file } from './harness.mjs'
import { sourceNestedDocx } from './source-nested-fixtures.mjs'
import { scormPackage } from './scorm-fixtures.mjs'

// Source custody enters through Sources and normal draft conversion, never direct D1 edits.
export async function sourceDraftWithdrawalCheck(f) {
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
