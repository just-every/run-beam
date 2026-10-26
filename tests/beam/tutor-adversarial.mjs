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
  assert.ok(!JSON.stringify(result).includes('synthetic-beam-95'),'Provider-written prose never becomes an answer')
  assert.ok(!result.result || result.result.status==='unanswered')
  assert.deepEqual(result.result?.citations ?? [],[])
  if(status===200) assert.equal(result.result.uncertainty,'The permitted material does not establish an answer. Ask the responsible expert.','Unsafe or incomplete support states uncertainty and the expert route')
  return {q,preview}
 }
 const visibleSource = async source => {
  const reference = await api('author','course.create',{title:'Authorized supporting material',reviewer:f.ids.reviewer})
  const draft = await api('author','course.lesson',{course:reference.id,draftVersion:reference.draftVersion,title:'Supporting reference',body:'Read the authorized supporting reference.',sources:[source.versionId]})
  reference.revision = (await api('author','course.submit',{course:reference.id,draftVersion:draft.draftVersion})).id
  await f.publish(reference.revision);return {reference,assignment:await f.assign(reference)}
 }
 const before = (await api('learner','./records/me')).completions
 const proveAnswer = async (question,sourceVersion=source.versionId,parts=1) => {
  setChoose(data=>{
   const passage = data.passages.find(p=>p.sourceVersion===sourceVersion && p.text.startsWith('Use clean tools')).id
   return {status:'answered',passages:[passage],support:Array.from({length:parts},(_,part)=>({part,passages:[passage]})),uncertainty:'The material is limited.'}
  })
  const q = await ask(question), preview = await api('owner',`tutor/${q.id}/preview`)
  await api('owner','tutor.run',{...preview,question:q.id,consent:true})
  const answer = (await api('learner',`tutor/${q.id}`)).result
  assert.equal(answer.status,'answered',question)
  assert.equal(answer.citations[0].text,preview.payload.passages.find(p=>p.id===answer.citations[0].id).text)
  return {q,answer}
 }
 const paraphrase = await proveAnswer('How should I prepare my equipment?')
 await proveAnswer('Which implements are suitable?')
 const conjunctive = await proveAnswer('How should I prepare my equipment and where should I put dirty implements?',source.versionId,2)
 await screens([['conjunctive-paraphrase','learner',`/app/tutor/${conjunctive.q.id}`,'Source-grounded answer']])
 await screens([['paraphrase','learner',`/app/tutor/${paraphrase.q.id}`,'Source-grounded answer']])
 const compatible = await api('author','source.create',{title:'Additional compatible procedure',reviewer:f.ids.reviewer,licence:'owned',licenceEvidence:'Employer-owned',provenance:'Compatible guidance',file:file('synthetic-beam-102.txt','Use clean tools before work. Inspect handles for damage.')})
 await visibleSource(compatible)
 await api('owner','tutor.source',{course:c.id,source:compatible.versionId,enabled:true,rightsConfirmed:true})
 const compatibleAnswer = await proveAnswer('What tools should I use before work?')
 await screens([['compatible','learner',`/app/tutor/${compatibleAnswer.q.id}`,'Source-grounded answer']])
 await api('owner','tutor.source',{course:c.id,source:compatible.versionId,enabled:false})

 const answered = passage => ({status:'answered',passages:[passage],support:[{part:0,passages:[passage]}],uncertainty:'synthetic-beam-95'})
 await execute('What tools should I use before work?',data=>answered(data.passages.find(p=>p.text.includes('break room closes')).id))
 await execute('What tools should I use before work?',()=>answered('synthetic-beam-96'),502)
 await execute('What tools should I use before work?',data=>answered(data.passages.find(p=>p.text.includes('UNTRUSTED INSTRUCTION')).id),502)
 const partial = await execute('What tools should I use before work and what replacement interval applies?',data=>answered(data.passages.find(p=>p.text.startsWith('Use clean tools')).id))
 await api('learner','tutor.handoff',{question:partial.q.id})
 assert.ok((await api('learner',`tutor/${partial.q.id}`)).thread,'Partial support has a working expert route')
 await screens([['partial','learner',`/app/tutor/${partial.q.id}`,'Unanswered question']])
 const conflicting = await api('author','source.create',{title:'Conflicting tool procedure',reviewer:f.ids.reviewer,licence:'owned',licenceEvidence:'Synthetic employer-owned procedure',provenance:'Unresolved conflicting policy',file:file('synthetic-beam-97.txt','Use dirty tools before work. Never use clean tools before work.')})
 await visibleSource(conflicting)
 await api('owner','tutor.source',{course:c.id,source:conflicting.versionId,enabled:true,rightsConfirmed:true})
 const conflict = await execute('What tools should I use before work?',data=>answered(data.passages.find(p=>p.sourceVersion===source.versionId && p.text.startsWith('Use clean tools')).id))
 await api('learner','tutor.handoff',{question:conflict.q.id})
 await screens([['conflicting','learner',`/app/tutor/${conflict.q.id}`,'Unanswered question']])
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
 const sessionQuestion = await ask('What tools should I use before work?'), sessionPreview = await api('owner',`tutor/${sessionQuestion.id}/preview`)
 const originalOwnerCookie = cookies.owner
 cookies.owner = await h.signIn('owner@example.test')
 const beforeReplacement = edge.calls.length
 await api('owner','tutor.run',{...sessionPreview,question:sessionQuestion.id,consent:true},409)
 assert.equal(edge.calls.length,beforeReplacement,'A different current owner session cannot consume approval')
 cookies.owner = originalOwnerCookie
 setChoose(data=>answered(data.passages.find(p=>p.sourceVersion===source.versionId && p.text.startsWith('Use clean tools')).id))
 setDuring(async()=>{setDuring(null);assert.equal((await h.raw('/auth/signout',{cookie:originalOwnerCookie,body:{}})).status,204)})
 await api('owner','tutor.run',{...sessionPreview,question:sessionQuestion.id,consent:true},502)
 cookies.owner = await h.signIn('owner@example.test')
 assert.equal((await api('learner',`tutor/${sessionQuestion.id}`)).result,null,'Revoked owner session cannot store a paid answer')
 console.log('PASS tutor current owner session replacement and revocation')
 const expiry = await proveAnswer('How should I prepare my equipment?')
 // Advance only the fixture clock; enrollment and its access rule stay unchanged.
 console.log('Tutor advancing pinned clock')
 await h.setClock(Date.parse('2026-10-27T12:00:01Z'))
 console.log('Tutor pinned clock advanced')
 for(const role of ['owner','learner']) await api(role,`tutor/${expiry.q.id}`,undefined,403)
 await api('learner',`tutor/${expiry.q.id}/citation?passage=${expiry.answer.citations[0].id}`,undefined,403)
 assert.equal((await h.raw(`/app/tutor/${expiry.q.id}`,{cookie:cookies.learner})).status,403)
 assert.equal((await h.raw(`/app/tutor/${expiry.q.id}/citation?passage=${expiry.answer.citations[0].id}`,{cookie:cookies.learner})).status,403)
 await h.setClock(Date.parse('2026-10-26T12:00:00Z'))
 // Pending erasure is a real public request, not a flag written into the database.
 const erased = await api('author','source.create',{title:'Withdrawn company addendum',reviewer:f.ids.reviewer,licence:'owned',licenceEvidence:'Employer-owned',provenance:'Obsolete addendum',file:file('synthetic-beam-98.txt','Use clean tools before work at the annex.')})
 const visibility = await visibleSource(erased)
 await api('owner','tutor.source',{course:c.id,source:erased.versionId,enabled:true,rightsConfirmed:true})
 await api('owner','erasure.hold',{kind:'source',subject:erased.id,justification:'Retain the original during the pending erasure qualification.'})
 setChoose(data=>answered(data.passages.find(p=>p.sourceVersion===erased.versionId).id))
 const stored = await ask('What tools should I use before work at the annex?'), storedPreview = await api('owner',`tutor/${stored.id}/preview`)
 await api('owner','tutor.run',{...storedPreview,question:stored.id,consent:true})
 const storedAnswer = (await api('learner',`tutor/${stored.id}`)).result
 assert.equal(storedAnswer.status,'answered')
 const storedCitation = storedAnswer.citations[0].id
 const staleVisibility = await ask('What tools should I use before work at the annex?'), stalePreview = await api('owner',`tutor/${staleVisibility.id}/preview`)
 await api('owner','assignment.cancel',{assignment:visibility.assignment,reason:'Source visibility withdrawn'})
 assert.deepEqual((await api('learner',`tutor/${stored.id}`)).result.citations,[],'A tutor grant never overrides withdrawn source visibility')
 await api('learner',`tutor/${stored.id}/citation?passage=${storedCitation}`,undefined,404)
 const callsBefore = edge.calls.length
 await api('owner','tutor.run',{...stalePreview,question:staleVisibility.id,consent:true},409)
 assert.equal(edge.calls.length,callsBefore)
 await f.assign(visibility.reference)
 assert.deepEqual((await api('learner',`tutor/${stored.id}`)).result.citations,[],'Restored source visibility cannot revive an earlier cache')
 const validBeforeErasure = await proveAnswer('How should I prepare my equipment?',erased.versionId)
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
 assert.deepEqual((await api('learner',`tutor/${validBeforeErasure.q.id}`)).result.citations,[],'Pending erasure fences a previously valid stored answer')
 await api('learner',`tutor/${validBeforeErasure.q.id}/citation?passage=${validBeforeErasure.answer.citations[0].id}`,undefined,404)
 assert.equal((await h.raw(`/app/tutor/${validBeforeErasure.q.id}/citation?passage=${validBeforeErasure.answer.citations[0].id}`,{cookie:cookies.learner})).status,404)
 const erasedPassage = erasurePreview.payload.passages.find(p=>p.sourceVersion===erased.versionId)
 await api('learner',`tutor/${pending.id}/citation?passage=${erasedPassage.id}`,undefined,404)
 assert.equal((await h.raw(`/app/tutor/${pending.id}/citation?passage=${erasedPassage.id}`,{cookie:cookies.learner})).status,404)
 assert.deepEqual((await api('learner','./records/me')).completions,before,'Adversarial tutor requests never create completion evidence')
 console.log('PASS tutor stored answer privacy boundaries')
 const audit = (await api('owner','audit')).events.filter(e=>/^(tutor|model)\./.test(e.action))
 const serialized = JSON.stringify(audit)
 for(const cookie of [originalOwnerCookie,...Object.values(cookies)]) for(const pair of cookie.split('; ')) assert.ok(!serialized.includes(pair.slice(pair.indexOf('=')+1)),'Audit excludes current and revoked session secrets')
 assertNoCanaries(audit,canaries)
 for(const wire of edge.calls) {
  const data = JSON.parse(wire.input[0].content[0].text)
  assert.ok(!serialized.includes(data.question),'No tutor audit event contains a question body')
  for(const passage of data.passages) assert.ok(!serialized.includes(passage.text),'No tutor audit event contains a passage body')
 }
 const failed = audit.filter(e=>e.action==='model.failed')
 assert.ok(failed.length>=4 && failed.every(e=>e.detail.run && e.detail.digest && e.detail.failure && e.detail.provider==='openai' && e.detail.billing==='unknown'),'Failures retain value-free decision and reservation lineage')
 setChoose(null)
}
