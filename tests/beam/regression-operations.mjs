import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'
import { sourceProcedurePdf } from './source-fixtures.mjs'

export async function operationsCheck() {
  const f=await fixture()
  try {
    const {api,h,ids,cookies}=f
    await api('learner','operations',undefined,403)
    await api('manager','operations',undefined,403)
    const initial=await api('owner','operations')
    assert.equal(initial.people,7)
    assert.equal(initial.readiness.database,'reachable')
    assert.equal(initial.readiness.files,'reachable')
    assert.equal(initial.jobs.length,5)
    assert.ok(initial.jobs.every(job=>job.outcome==='not_run'&&job.lastSuccessAt===null))
    const roster=await api('owner','people.batch.preview',{file:file('health-roster.csv','Employee ID,Name,Email\nsynthetic-beam-301,First employee,first@health.test\nsynthetic-beam-302,Second employee,second@health.test\n')})
    await api('owner','people.batch.apply',{batch:roster.id,limit:1})
    assert.equal((await api('owner','operations')).backlog.rosterRows,1)
    await api('owner','people.batch.apply',{batch:roster.id})
    assert.equal((await api('owner','operations')).backlog.rosterRows,0)
    await api('owner','person.directory',{member:ids.learner,employeeId:'synthetic-beam-303'})
    const mapping=await api('owner','gusto.language.configure',{member:ids.learner,employeeId:'synthetic-beam-303',employeeUuid:'synthetic-beam-304',companyUuid:'synthetic-beam-305',fieldId:'synthetic-beam-306',environment:'demo',version:0,consent:true})
    assert.equal((await api('owner','gusto.language.pull',{mapping:mapping.id,version:mapping.version})).outcome,'gusto_token_missing')
    const source=await api('author','source.create',{title:'Operations refusal',reviewer:ids.reviewer,licence:'owned',licenceEvidence:'Employer original',provenance:'Synthetic scan',file:file('health.pdf',sourceProcedurePdf(true))})
    await api('owner','source.ocr.configure',{operation:'enable',apiKey:'synthetic-beam-307',maxCostCents:1000,totalBudgetCents:0,accountMode:'sandbox',agreementConfirmed:true,consent:true})
    const preview=await api('owner',`sources/${source.versionId}/ocr-preview`)
    await api('owner','source.ocr.run',{...preview,consent:true},409)
    await h.scheduled()
    const current=await api('owner','operations')
    assert.equal(current.people,7)
    assert.equal(current.directoryPeople,9)
    assert.ok(current.jobs.every(job=>job.outcome==='succeeded'&&job.lastSuccessAt>=initial.asOf))
    assert.deepEqual([current.synchronization.configured,current.synchronization.stale,current.synchronization.failures],[1,1,1])
    assert.equal(current.synchronization.lastSuccessAt,null)
    assert.equal(current.failures.ocr,1)
    assert.equal(current.storage.originals,1)
    assert.equal(current.storage.originalBytes,sourceProcedurePdf(true).length)
    assert.equal(current.costs.ocr.reservedEstimateCents,0)
    assert.ok(!JSON.stringify(current).includes('synthetic-beam-307'))
    const page=await (await h.raw('/app/business',{cookie:cookies.owner})).text()
    assert.ok(page.includes('Installation health')&&page.includes('USD 0.00')&&page.includes('25000000'))
    assert.ok(!page.includes('synthetic-beam-307'))
  } finally {await f.h.close()}
}
