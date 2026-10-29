import assert from 'node:assert/strict'
import { file } from './harness.mjs'

export async function loadTutorCanaries(f, c) {
 const {api,ids} = f
 const canaries = ['synthetic-beam-91','synthetic-beam-92','synthetic-beam-93','synthetic-beam-94','synthetic-beam-99','synthetic-beam-100','synthetic-beam-101']
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
 const assessed = await api('author','course.create',{title:'Private assessed work',reviewer:ids.reviewer})
 let version = (await api('author','course.lesson',{course:assessed.id,draftVersion:assessed.draftVersion,title:'Procedure',body:'Inspect before work.',sources:[]})).draftVersion
 version = (await api('author','course.question',{course:assessed.id,draftVersion:version,kind:'text',prompt:'Describe your preparation',guidance:'Inspect first and demonstrate safe preparation'})).draftVersion
 version = (await api('author','course.assessment',{course:assessed.id,draftVersion:version,passPercent:100,maxAttempts:2,practicalInstructions:'Show preparation',assessor:ids.assessor})).draftVersion
 await f.publish((await api('author','course.submit',{course:assessed.id,draftVersion:version})).id)
 const assessedAssignment = await f.assign(assessed)
 await f.lessons(assessedAssignment)
 const question = (await f.view(assessedAssignment)).quiz.questions[0]
 const assessmentAttempt = await api('learner','quiz.submit',{assignment:assessedAssignment,[`q_${question.id}`]:canaries[5]})
 const practicalAttempt = await api('learner','practical.submit',{assignment:assessedAssignment,evidence:canaries[6],file:file('synthetic-beam-101.txt',canaries[6])})
 assert.ok(JSON.stringify(await api('learner',`attempts/${assessmentAttempt.id}`)).includes(canaries[5]),'The assessment answer canary is stored')
 assert.equal((await api('learner',`attempts/${practicalAttempt.id}`)).evidence,canaries[6],'The practical evidence canary is stored')
 assert.ok((await f.view(assessedAssignment)).attempts.length>=2,'Assessment and practical canaries are populated')
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
 assert.equal(approved.detail.provider,'openai')
 assert.ok(events.filter(e=>e.action.startsWith('model.')).every(e=>e.detail.provider==='openai'),'Provider identity survives every paid decision event')
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
 for(const secret of ['synthetic-beam-103',...Object.values(f.cookies).flatMap(cookie=>cookie.split('; ').map(pair=>pair.slice(pair.indexOf('=')+1))),...['SESSION_SECRET','SETUP_TOKEN','MAIL_API_KEY'].map(name=>f.h.vars[name])].filter(value=>typeof value==='string' && value.length>10)) assert.ok(!serialized.includes(secret),'Audit excludes credentials and session secrets')
}
