import assert from 'node:assert/strict'
import { file } from './harness.mjs'

export async function loadTutorCanaries(f, c) {
 const {api,ids} = f
 const canaries = ['synthetic-beam-91','synthetic-beam-92','synthetic-beam-93','synthetic-beam-94','synthetic-beam-99']
 await api('author','source.create',{title:'Restricted personnel instructions',reviewer:ids.reviewer,licence:'owned',licenceEvidence:'Employer-owned',provenance:'Private personnel office',file:file('synthetic-beam-91.txt',canaries[0])})
 const invisible = await api('author','source.create',{title:'Unassigned restricted appendix',reviewer:ids.reviewer,licence:'owned',licenceEvidence:'Employer-owned',provenance:'Private source visibility',file:file('synthetic-beam-99.txt',canaries[4])})
 await api('owner','tutor.source',{course:c.id,source:invisible.versionId,enabled:true,rightsConfirmed:true})
 const otherAssignment = (await api('owner','assignment.create',{course:c.id,learners:[ids.other],dueDate:'2030-10-01',dueTime:'17:00',timezone:'UTC'})).created[0]
 await api('other','tutor.ask',{assignment:otherAssignment,question:canaries[1],consent:true})
 const propose = async (role,kind,payload) => {
  const p = await api(role,'agent.propose',{kind,title:'Tutor privacy qualification',reasons:['Verify context exclusion'],payload})
  return (await api(role==='manager'?'owner':'reviewer','agent.decide',{proposal:p.id,decision:'approve',sha256:p.sha256})).result
 }
 const plan = (await propose('manager','question_plan',{title:'Anonymous work conditions',purpose:'Confidential diagnostic',questions:['What is getting in the way?'],participants:[ids.learner],closesOn:'2099-10-01'})).plan
 await api('learner','questions.answer',{plan,answer1:canaries[2]})
 const scenario = (await propose('author','scenario',{course:c.id,courseRevision:c.revision,title:'Private preparation practice',rubric:'Never graded',steps:[{id:canaries[3],situation:'Prepare for work',choices:[{label:'Inspect first',feedback:'Check before work.',next:null},{label:'Ask the expert',feedback:'Ask before work.',next:null}]}]})).scenario
 await api('learner','practice.choose',{scenario,step:canaries[3],choice:1})
 assert.equal((await api('learner',`practice/${scenario}`)).finished,true)
 return canaries
}

export function assertNoCanaries(value, canaries) {
 const serialized = typeof value === 'string' ? value : JSON.stringify(value)
 for (const canary of canaries) assert.ok(!serialized.includes(canary),`Restricted context ${canary} is absent`)
}

export async function assertTutorLineage(f, question, preview, canaries) {
 const events = (await f.api('owner','audit')).events.filter(e=>e.subject===question || e.detail?.resultId===question)
 const asked = events.find(e=>e.action==='tutor.ask'), approved = events.find(e=>e.action==='model.approve'), answered = events.find(e=>e.action==='tutor.answer')
 assert.ok(asked && approved && answered,'Consent, exact approval and outcome retain decision lineage')
 assert.equal(asked.actor,f.ids.learner)
 assert.equal(approved.actor,f.ids.owner)
 assert.equal(approved.detail.digest,preview.digest)
 assert.equal(approved.detail.revision,preview.payload.revision)
 assert.ok(approved.detail.run && approved.detail.consentAt && approved.detail.consentVersion)
 assert.equal(approved.detail.model,preview.model)
 assert.equal(approved.detail.configVersion,(await f.api('owner','model-account')).version)
 assert.equal(approved.detail.policyVersion,(await f.api('owner','automation-controls')).policy.version)
 assert.deepEqual(approved.detail.sources,preview.sources)
 assert.deepEqual(approved.detail.grants,preview.grants)
 assert.equal(approved.detail.estimateCents,preview.estimateCents)
 assert.equal(approved.detail.maxCostCents,preview.maxCostCents)
 assert.ok(approved.at && approved.detail.reservationDay)
 assert.equal(answered.detail.run,approved.detail.run)
 assertNoCanaries(events,canaries)
 const serialized = JSON.stringify(events)
 assert.ok(!serialized.includes(preview.payload.question),'Audit excludes the question body')
 for (const p of preview.payload.passages) assert.ok(!serialized.includes(p.text),'Audit excludes passage bodies')
 assert.ok(!serialized.includes(preview.approval),'Audit excludes session-bound approval ciphertext')
}
