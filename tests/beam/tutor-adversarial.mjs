import assert from 'node:assert/strict'
import { file } from './harness.mjs'
import { assertNoCanaries } from './tutor-privacy.mjs'

export async function tutorAdversarial({f,c,source,assignment,ask,edge,setChoose,setDuring,canaries,screens}) {
 const {api,h,cookies} = f
 const execute = async (question,select,status=200) => {
  setChoose(select)
  const q = await ask(question), preview = await api('owner',`tutor/${q.id}/preview`)
  await api('owner','tutor.run',{...preview,question:q.id,consent:true},status)
  assertNoCanaries(edge.calls.at(-1),canaries)
  const result = await api('learner',`tutor/${q.id}`)
  assertNoCanaries(result,canaries)
  assert.ok(!result.result || result.result.status==='unanswered')
  assert.deepEqual(result.result?.citations ?? [],[])
  return {q,preview}
 }
 const answered = passage => ({status:'answered',passages:[passage],uncertainty:'synthetic-beam-provider-prose-95'})
 await execute('What tools should I use before work?',data=>answered(data.passages.find(p=>p.text.includes('break room closes')).id))
 await execute('What tools should I use before work?',()=>answered('synthetic-beam-unknown-96'),502)
 await execute('What tools should I use before work?',data=>answered(data.passages.find(p=>p.text.includes('UNTRUSTED INSTRUCTION')).id),502)
 const partial = await execute('What tools should I use before work and what replacement interval applies?',data=>answered(data.passages.find(p=>p.text.startsWith('Use clean tools')).id))
 await api('learner','tutor.handoff',{question:partial.q.id})
 assert.ok((await api('learner',`tutor/${partial.q.id}`)).thread,'Partial support has a working expert route')
 const conflicting = await api('author','source.create',{title:'Conflicting tool procedure',reviewer:f.ids.reviewer,licence:'owned',licenceEvidence:'Synthetic employer-owned procedure',provenance:'Unresolved conflicting policy',file:file('synthetic-beam-97.txt','Use dirty tools before work. Never use clean tools before work.')})
 await api('owner','tutor.source',{course:c.id,source:conflicting.versionId,enabled:true,rightsConfirmed:true})
 const conflict = await execute('What tools should I use before work?',data=>answered(data.passages.find(p=>p.sourceVersion===source.versionId && p.text.startsWith('Use clean tools')).id))
 await api('learner','tutor.handoff',{question:conflict.q.id})
 await screens([['partial','learner',`/app/tutor/${partial.q.id}`,'Unanswered question'],['conflicting','learner',`/app/tutor/${conflict.q.id}`,'Unanswered question']])
 await api('owner','tutor.source',{course:c.id,source:conflicting.versionId,enabled:false})
 setChoose(data=>answered(data.passages.find(p=>p.sourceVersion===source.versionId && p.text.startsWith('Use clean tools')).id))
 const inFlight = await ask('What tools should I use before work?'), preview = await api('owner',`tutor/${inFlight.id}/preview`)
 setDuring(async()=>{setDuring(null);await api('owner','tutor.source',{course:c.id,source:source.versionId,enabled:false})})
 await api('owner','tutor.run',{...preview,question:inFlight.id,consent:true},502)
 assert.equal((await api('learner',`tutor/${inFlight.id}`)).result,null,'Revocation during a provider request stores no answer')
 const passage = preview.payload.passages.find(p=>p.sourceVersion===source.versionId)
 await api('learner',`tutor/${inFlight.id}/citation?passage=${passage.id}`,undefined,404)
 assert.equal((await h.raw(`/app/tutor/${inFlight.id}/citation?passage=${passage.id}`,{cookie:cookies.learner})).status,404)
 await api('owner','tutor.source',{course:c.id,source:source.versionId,enabled:true,rightsConfirmed:true})
 // Pending erasure is a real public request, not a flag written into the database.
 const erased = await api('author','source.create',{title:'Withdrawn company addendum',reviewer:f.ids.reviewer,licence:'owned',licenceEvidence:'Employer-owned',provenance:'Obsolete addendum',file:file('synthetic-beam-98.txt','Use clean tools before work at the annex.')})
 await api('owner','tutor.source',{course:c.id,source:erased.versionId,enabled:true,rightsConfirmed:true})
 const pending = await ask('What tools should I use before work at the annex?'), erasurePreview = await api('owner',`tutor/${pending.id}/preview`)
 await api('owner','erasure.policy',{assessmentDays:0,justification:'Employer-approved erasure qualification',consent:true})
 setChoose(data=>answered(data.passages.find(p=>p.sourceVersion===erased.versionId).id))
 setDuring(async()=>{
  setDuring(null)
  const removal = await api('owner','erasure.preview',{kind:'source',subject:erased.id})
  await api('owner','erasure.begin',{...removal,justification:'Withdraw obsolete addendum',consent:true})
 })
 await api('owner','tutor.run',{...erasurePreview,question:pending.id,consent:true},502)
 assert.equal((await api('learner',`tutor/${pending.id}`)).result,null,'Pending source erasure fences an in-flight response')
 const erasedPassage = erasurePreview.payload.passages.find(p=>p.sourceVersion===erased.versionId)
 await api('learner',`tutor/${pending.id}/citation?passage=${erasedPassage.id}`,undefined,404)
 assert.equal((await h.raw(`/app/tutor/${pending.id}/citation?passage=${erasedPassage.id}`,{cookie:cookies.learner})).status,404)
 setChoose(null)
}
