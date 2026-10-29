// Shared paid-network fixture for real answered-cache erasure and restore flows.
import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'
import { modelEdge } from './model-edge.mjs'
export const tutorCustodyEdge = () => modelEdge(data => {
 const passage = data.passages.find(p => p.lesson)
 assert.ok(passage,'A published original exists before populating the cache')
 return {status:'answered',passages:[passage.id],support:[{part:0,passages:[passage.id]}],uncertainty:'Only the published procedure is supported.'}
})
export const tutorCustodyFixture = () => fixture({outboundService:tutorCustodyEdge().outboundService})
export async function populateAnsweredTutor(f,assignment) {
 const {api}=f
 const account=await api('owner','model-account')
 if(!account.enabled || !account.hasKey) await api('owner','model.configure',{operation:'enable',apiKey:'synthetic-beam-105',maxCostCents:1000,consent:true})
 const policy=(await api('owner','automation-controls')).policy
 await api('owner','automation.policy',{...policy,dailySpendLimitCents:100000})
 const question=await api('learner','tutor.ask',{assignment,question:'How do I carry out this procedure?',consent:true})
 const preview=await api('owner',`tutor/${question.id}/preview`)
 await api('owner','tutor.run',{...preview,question:question.id,consent:true})
 const answer=(await api('learner',`tutor/${question.id}`)).result
 assert.equal(answer.status,'answered','Custody starts with a populated answered cache')
 assert.equal(answer.citations.length,1)
 assert.equal(answer.citations[0].text,preview.payload.passages.find(p=>p.id===answer.citations[0].id).text)
 return {id:question.id,citation:answer.citations[0].id}
}
