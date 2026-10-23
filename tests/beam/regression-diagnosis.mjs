import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'

// AGENT-002: rule-made knowledge-gap vs unusable-process diagnoses through real public doors.
// The optional browser pass uses the same populated installation and both widths.
export async function diagnosisCheck() {
 const f = await fixture()
 try { await diagnosis(f) } finally { await f.h.close() }
}
async function diagnosis({ api, h, ids, cookies, course, publish }) {
 const c = await course('Cold-chain label procedure'), members = [], sessions = []
 const source = await api('author', 'source.create', { title: 'Packing SOP', licence: 'owned', licenceEvidence: 'Employer-owned procedure', reviewer: ids.reviewer, provenance: 'Packing station SOP', file: file('packing.txt', 'Apply the label before moving the crate.') })
 const updated = await api('author', 'course.lesson', { course: c.id, draftVersion: (await api('author', `courses/${c.id}`)).draftVersion, title: 'Label the crate', body: 'Apply the label before moving the crate.', sources: [source.versionId] })
 c.revision = (await api('author', 'course.submit', { course: c.id, draftVersion: updated.draftVersion })).id
 await publish(c.revision)
 if (process.env.BEAM_DIAGNOSIS_BROWSER === '1') await browserProof(h, cookies.manager, [])
 for (let i = 1; i <= 6; i++) {
  const email = `packer${i}@example.test`
  const id = (await api('owner', 'person.invite', { email, name: `Packing operator ${i}`, roles: ['learner'] })).id
  members.push(id); sessions.push(await h.signIn(email, { requested: true }))
  await api('owner', 'person.directory', { member: id, employeeId: `DX${i}`, jobRole: 'Packing' })
 }
 await api('owner', 'team.members', { team: ids.team, members })
 await api('owner', 'person.directory', { member: ids.learner, employeeId: 'DX-OUT', jobRole: 'Packing' })
 const complete = async i => {
  const assignment = (await api('manager', 'assignment.create', { course: c.id, learners: [members[i]], dueDate: '2030-01-01', dueTime: '17:00', timezone: 'UTC' })).created[0]
  for (const lesson of (await h.api(`assignments/${assignment}`, sessions[i])).lessons) await h.api('lesson.complete', sessions[i], { assignment, lesson: lesson.id })
 }
 for (let i = 0; i < 3; i++) await complete(i)
 // Staff questions are voluntary and delivered only after a manager approves the exact proposal.
 const proposed = await api('manager', 'agent.propose', { kind: 'question_plan', title: 'Where does labelling fail?', reasons: ['Understand the packing problem before choosing training.'], payload: { title: 'Packing clarity', purpose: 'Find unclear instructions and tool problems', questions: ['Is the label instruction usable?'], participants: members, closesOn: '2031-01-01' } })
 assert.ok(!(await (await h.raw('/app', { cookie: sessions[0] })).text()).includes('Packing clarity'), 'questions are not delivered before approval')
 await api('manager', 'agent.decide', { proposal: proposed.id, decision: 'approve', sha256: proposed.sha256 })
 const questionPlan = (await api('manager', `proposals/${proposed.id}`)).result.plan
 assert.ok((await (await h.raw('/app', { cookie: sessions[0] })).text()).includes('Packing clarity'))
 for (let i = 0; i < 3; i++) await h.api('questions.answer', sessions[i], { plan: questionPlan, answer1: 'PRIVATE STAFF ANSWER: label printer is across the building.' })
 const parameters = { purpose: 'diagnosis', course: c.id, jobRole: 'Packing', metric: 'Labels missed per 100 crates', unit: 'misses / 100 crates', from: '2030-02-01', to: '2030-02-28', questionPlan }
 const csv = 'Employee ID,Date,Value,Private customer note\n' + members.map((_, i) => `DX${i + 1},2030-02-${i === 0 ? '01' : '28'},${i < 3 ? 1 : 8},CUSTOMER SECRET`).join('\n') + '\nUNKNOWN,2030-02-05,9,secret\nDX1,2030-03-01,9,secret\nDX1,2030-02-30,9,secret\nDX1,2030-02-05,-1,secret\nDX-OUT,2030-02-05,7,secret'
 const imported = await api('manager', 'outcome.import', { ...parameters, file: file('packing-errors.csv', csv, 'text/csv') })
 assert.deepEqual([imported.actor, imported.filename, imported.rows, imported.kept, imported.refused.length], [ids.manager, 'packing-errors.csv', 11, 6, 5])
 assert.ok(imported.importedAt > 0)
 assert.deepEqual(imported.refused.map(r => r.reason), ['outside_managed_cohort', 'outside_window', 'invalid_date', 'invalid_value', 'outside_managed_cohort'])
 const read = id => api('manager', `diagnosis-imports/${id}`)
 let view = await read(imported.id)
 assert.equal(view.questions.hidden, 'open_or_below_bound')
 await api('manager', 'questions.close', { plan: questionPlan })
 view = await read(imported.id)
 assert.deepEqual([view.preparedBy, view.finding, view.trainingRefused], ['rule', 'knowledge_gap', false])
 assert.deepEqual([view.groups.trained.n, view.groups.untrained.n, view.groups.trained.mean, view.groups.untrained.mean], [3, 3, 1, 8])
 assert.deepEqual(view.groups.untrained.interval, [8, 8])
 assert.deepEqual([view.basis.from, view.basis.to, view.basis.timezone, view.basis.revision], ['2030-02-01', '2030-02-28', 'UTC', c.revision])
 assert.equal(view.procedure[0].body, 'Perform the owned procedure.')
 assert.ok(view.procedure.some(lesson => lesson.sources.includes(source.versionId)))
 assert.match(view.uncertainty, /not causation or competence/); assert.match(view.uncertainty, /Missing values and small samples/)
 assert.deepEqual(view.alternatives.map(a => a.kind).sort(), ['clearer_instructions', 'no_intervention', 'process_change', 'training'])
 assert.ok(view.alternatives.every(alternative => alternative.reason.length > 0))
 assert.ok(view.procedure[0].id && view.alternatives.length === 4 && view.alternatives.find(a => a.kind === 'training').supported)
 assert.deepEqual([view.questions.answered, view.questions.totals[0].responses], [3, 3])
 for (const hidden of [...members, 'PRIVATE STAFF ANSWER', 'CUSTOMER SECRET', 'DX1']) assert.ok(!JSON.stringify(view).includes(hidden), hidden)
 assert.equal((await api('manager', `diagnosis-imports/${imported.id}?rank=mean`, undefined, 400)).error, 'individual_results_refused')
 await api('learner', `diagnosis-imports/${imported.id}`, undefined, 403)
 const unrelated = (await api('owner', 'person.invite', { email: 'unrelated@example.test', name: 'Unrelated manager', roles: ['manager'] })).id
 const unrelatedCookie = await h.signIn('unrelated@example.test', { requested: true })
 await h.api(`diagnosis-imports/${imported.id}`, unrelatedCookie, undefined, 403)
 assert.ok(!(await h.api('diagnoses', unrelatedCookie)).some(d => d.importId === imported.id))
 await api('reviewer', `diagnosis-imports/${imported.id}`)
 await api('owner', `diagnosis-imports/${imported.id}`)
 const token = (await api('manager', 'agent.issue', { expiresInSeconds: 900 })).token
 const agent = async (path, body, status = 200) => {
  const r = await h.fetch(`/api/beam/${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, origin: h.origin, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text(); assert.equal(r.status, status, text.slice(0, 300)); return JSON.parse(text)
 }
 await agent(`diagnosis-imports/${imported.id}`)
 await agent('outcome.import', { ...parameters, csv }, 403)
 const prepared = await agent('diagnosis.prepare', { import: imported.id })
 await api('reviewer', 'diagnosis.review', { diagnosis: prepared.id })
 const option = { id: 'targeted', kind: 'cohort_assignment', summary: 'Short label refresher', expectedBenefit: 'Reduce errors where knowledge is missing', people: members.slice(3), paidMinutesPerPerson: 5, course: c.id, courseRevision: c.revision, dueDate: '2030-04-01', dueTime: '17:00', timezone: 'UTC' }
 const intervention = diagnosis => ({ kind: 'intervention', title: 'Packing alternatives', inputs: [{ type: 'diagnosis', id: diagnosis }], reasons: ['Compare the cited evidence.'], payload: { diagnosis, recommended: 'targeted', options: [option, { ...option, id: 'broad', kind: 'broad_course', people: [...members, ids.learner] }, { id: 'process', kind: 'process_change', summary: 'Move the printer', expectedBenefit: 'Make the procedure usable', people: [], paidMinutesPerPerson: 0 }] } })
 const allowed = await agent('agent.propose', intervention(prepared.id))
 assert.ok(allowed.id)
 // Now every error-making person is already trained: the same public import/diagnosis path must recommend process.
 for (let i = 3; i < 6; i++) await complete(i)
 const processImport = await api('manager', 'outcome.import', { ...parameters, csv })
 const processDiagnosis = await agent('diagnosis.prepare', { import: processImport.id })
 assert.deepEqual([processDiagnosis.comparison.finding, processDiagnosis.comparison.trainingRefused, processDiagnosis.comparison.groups.trained.n, processDiagnosis.comparison.groups.untrained.n], ['process', true, 6, 0])
 await api('reviewer', 'diagnosis.review', { diagnosis: processDiagnosis.id })
 assert.equal((await agent('agent.propose', intervention(processDiagnosis.id), 409)).error, 'training_unsupported')
 const choices = intervention(processDiagnosis.id); choices.payload.recommended = 'process'
 const processProposal = await agent('agent.propose', choices)
 assert.equal((await api('manager', 'agent.decide', { proposal: processProposal.id, decision: 'approve', sha256: processProposal.sha256, option: 'broad' }, 409)).error, 'training_unsupported')
 // The same AGENT-005 door still imports ordinary approved intervention outcomes when purpose is omitted.
 const ordinary = structuredClone(choices)
 ordinary.payload.options.find(option => option.id === 'process').people = members
 const measured = await agent('agent.propose', ordinary)
 const plan = (await api('manager', 'outcome.plan', { intervention: measured.id, metric: 'Packing errors', unit: 'errors / 100 crates', direction: 'lower', baselineFrom: '2030-02-01', baselineTo: '2030-02-28', afterFrom: '2030-03-01', afterTo: '2030-03-31', comparison: 'none', minGroup: 3 })).id
 await api('manager', 'outcome.approve', { plan })
 await api('manager', 'agent.decide', { proposal: measured.id, decision: 'approve', sha256: measured.sha256 })
 const ordinaryReceipt = await api('manager', 'outcome.import', { plan, csv: 'Employee ID,Date,Value\n' + members.flatMap((_, i) => [`DX${i + 1},2030-02-05,2`, `DX${i + 1},2030-03-05,1`]).join('\n') })
 assert.deepEqual([ordinaryReceipt.stored, ordinaryReceipt.refused.length], [12, 0])
 assert.equal((await api('manager', `outcomes/${plan}`)).exposed.change, -1)
 // Missing values stay missing, never zero; an all-blank period stays unmeasured.
 const blank = await api('manager', 'outcome.import', { ...parameters, csv: 'Employee ID,Date,Value\n' + members.map((_, i) => `DX${i + 1},2030-02-05,${i < 3 ? '' : 4}`).join('\n') })
 const missing = await read(blank.id)
 assert.deepEqual([missing.groups.trained.measured, missing.groups.trained.missing, missing.groups.trained.mean], [3, 3, 4])
 const practical = await course('Operational practical evidence', true)
 const attempted = []
 for (let i=0;i<3;i++) {
  const assignment = (await api('manager', 'assignment.create', { course: practical.id, learners: [members[i]], dueDate: '2030-10-01' })).created[0]
  for (const lesson of (await h.api(`assignments/${assignment}`, sessions[i])).lessons) await h.api('lesson.complete', sessions[i], { assignment, lesson: lesson.id })
  attempted.push((await h.api('practical.submit', sessions[i], { assignment, evidence: 'PRIVATE ASSESSMENT DETAIL' })).id)
 }
 const attemptFeed = (await api('manager', 'error-feed.authorize', { course: practical.id, jobRole: 'Packing', teams: [ids.team], consent: true })).id
 const attemptImport = await api('manager', 'outcome.import', { ...parameters, course: practical.id, feed: attemptFeed, records: members.map((_,i) => ({ id: `synthetic-beam-${i+20}`, employeeId: `DX${i+1}`, date: '2030-02-05', value: 2 })) })
 const attemptView = await read(attemptImport.id)
 assert.deepEqual(attemptView.attemptEvidence.citations.map(a => a.id).sort(), attempted.sort())
 assert.ok(!JSON.stringify(attemptView).includes('PRIVATE ASSESSMENT DETAIL'))
 // No individual inference via a near-duplicate cohort or groups below three.
 await api('owner', 'person.directory', { member: members[5], jobRole: 'Other role' })
 const near = await api('manager', 'outcome.import', { ...parameters, csv })
 const protectedView = await read(near.id)
 assert.equal(protectedView.groups.trained.hidden, 'privacy_bound')
 assert.equal(protectedView.groups.trained.mean, null)
 await api('owner', 'person.directory', { member: members[5], jobRole: 'Packing' })
 for (const member of members.slice(0, 2)) await api('owner', 'person.directory', { member, jobRole: 'Small cohort' })
 const small = await api('manager', 'outcome.import', { ...parameters, jobRole: 'Small cohort', csv })
 assert.equal((await read(small.id)).groups.trained.hidden, 'privacy_bound')
 for (const member of members.slice(0, 2)) await api('owner', 'person.directory', { member, jobRole: 'Packing' })
 // A closed plan with only two respondents contributes no answer totals.
 const tooFew = await api('manager', 'agent.propose', { kind: 'question_plan', title: 'Follow-up questions', reasons: ['More evidence'], payload: { title: 'Follow-up', purpose: 'Check process', questions: ['What is unclear?'], participants: members, closesOn: '2031-01-01' } })
 await api('manager', 'agent.decide', { proposal: tooFew.id, decision: 'approve', sha256: tooFew.sha256 })
 const fewPlan = (await api('manager', `proposals/${tooFew.id}`)).result.plan
 for (let i = 0; i < 2; i++) await h.api('questions.answer', sessions[i], { plan: fewPlan, answer1: 'Private concern' })
 await api('manager', 'questions.close', { plan: fewPlan })
 const fewImport = await api('manager', 'outcome.import', { ...parameters, questionPlan: fewPlan, csv })
 assert.deepEqual((await read(fewImport.id)).questions.totals, [])
 // Explicit operational grants cover CSV and API records; private record bodies never become evidence.
 const grant = { course: c.id, jobRole: 'Packing', teams: [ids.team], consent: true }
 await api('learner', 'error-feed.authorize', grant, 403)
 await api('manager', 'error-feed.authorize', { ...grant, consent: false }, 400)
 const outsideTeam = (await api('owner', 'team.create', { name: 'Outside operational scope' })).id
 await api('manager', 'error-feed.authorize', { ...grant, teams: [outsideTeam] }, 403)
 const feed = (await api('manager', 'error-feed.authorize', grant)).id
 const records = members.map((_, i) => ({ id: `synthetic-beam-${i+1}`, employeeId: `DX${i+1}`, date: '2030-02-05', value: i < 3 ? 1 : 8, customer: 'CUSTOMER SECRET', employeeDetail: 'PRIVATE DETAIL' }))
 records.push({ ...records[0], value: 9 }, { ...records[0], id: 'synthetic-beam-7', employeeId: 'DX-OUT' })
 const operational = await api('manager', 'outcome.import', { ...parameters, feed, records })
 assert.deepEqual([operational.kept, operational.refused.map(r => r.reason)], [6, ['conflicting_record_id', 'outside_managed_cohort']])
 const scopedView = await read(operational.id)
 assert.deepEqual(scopedView.records.map(r => r.id), members.map((_,i) => `synthetic-beam-${i+1}`))
 assert.equal(scopedView.attemptEvidence.signal, 'missing')
 assert.ok(scopedView.procedure.some(l => l.sources.includes(source.versionId)))
 for (const text of ['CUSTOMER SECRET', 'PRIVATE DETAIL', 'DX1']) assert.ok(!JSON.stringify(scopedView).includes(text))
 await api('manager', 'outcome.import', { ...parameters, feed, jobRole: 'Another role', records }, 403)
 await h.api('outcome.import', unrelatedCookie, { ...parameters, feed, records }, 404)
 await agent('error-feed.authorize', grant, 403)
 const operationalDiagnosis = await agent('diagnosis.prepare', { import: operational.id })
 await api('reviewer', 'diagnosis.review', { diagnosis: operationalDiagnosis.id })
 const safeProposal = intervention(operationalDiagnosis.id); safeProposal.payload.recommended = 'process'
 const waiting = await agent('agent.propose', safeProposal)
 const csvReceipt = await api('manager', 'outcome.import', { ...parameters, feed, csv: 'Employee ID,Date,Value,Record ID,Customer\nDX1,2030-02-05,1,synthetic-beam-8,CUSTOMER SECRET' })
 assert.equal((await read(csvReceipt.id)).records[0].id, 'synthetic-beam-8')
 await api('reviewer', 'error-feed.revoke', { feed }, 404)
 await api('manager', 'error-feed.revoke', { feed })
 for (const id of [operational.id, csvReceipt.id]) {
  const revoked = await read(id); assert.equal(revoked.withdrawn, true); assert.equal(revoked.records, undefined)
 }
 assert.ok(!(await api('manager', 'diagnoses')).some(d => d.importId === operational.id))
 assert.equal((await agent('diagnosis.prepare', { import: operational.id }, 409)).error, 'import_withdrawn')
 assert.equal((await api('manager', 'agent.decide', { proposal: waiting.id, sha256: waiting.sha256, decision: 'approve' }, 409)).error, 'diagnosis_basis_withdrawn')
 await api('manager', 'outcome.import', { ...parameters, feed, records }, 409)
 // A live team change invalidates saved comparisons and permanently scrubs their observations.
 const scopeFeed = (await api('manager', 'error-feed.authorize', grant)).id
 const scopeImport = await api('manager', 'outcome.import', { ...parameters, feed: scopeFeed, records })
 await api('owner', 'team.members', { team: ids.team, members: members.slice(0,5) })
 assert.equal((await read(scopeImport.id)).withdrawn, true)
 await api('owner', 'team.members', { team: ids.team, members })
 assert.equal((await read(scopeImport.id)).withdrawn, true)
 const authorityImport = await api('manager', 'outcome.import', { ...parameters, feed: scopeFeed, records })
 await api('owner', 'team.managers', { team: ids.team, members: [] })
 assert.equal((await api('reviewer', `diagnosis-imports/${authorityImport.id}`)).withdrawn, true)
 await api('owner', 'team.managers', { team: ids.team, members: [ids.manager] })
 assert.equal((await read(authorityImport.id)).withdrawn, true)
 const audit = JSON.stringify(await api('owner', 'audit?q=error-feed'))
 assert.ok(!audit.includes('CUSTOMER SECRET') && !audit.includes('PRIVATE DETAIL'))
 // Browser proof covers both populated findings, the receipt, withdrawal, and empty state using the real Worker.
 if (process.env.BEAM_DIAGNOSIS_BROWSER === '1') await browserProof(h, cookies.manager, [imported.id, processImport.id])
 await api('reviewer', 'diagnosis.withdraw', { import: processImport.id }, 403)
 await api('manager', 'diagnosis.withdraw', { import: processImport.id })
 assert.equal((await read(processImport.id)).withdrawn, true)
 assert.ok(!(await api('manager', 'diagnoses')).some(d => d.importId === processImport.id), 'withdrawn evidence is omitted from later diagnosis reads')
 if (process.env.BEAM_DIAGNOSIS_BROWSER === '1') await browserProof(h, cookies.manager, [processImport.id], true)
 assert.equal((await agent('diagnosis.prepare', { import: processImport.id }, 409)).error, 'import_withdrawn')
 assert.equal((await agent('agent.propose', choices, 409)).error, 'diagnosis_basis_withdrawn')
 assert.equal((await api('manager', 'agent.decide', { proposal: processProposal.id, decision: 'approve', sha256: processProposal.sha256 }, 409)).error, 'diagnosis_basis_withdrawn')
 assert.ok((await api('owner', 'audit?q=diagnosis.import')).events.some(e => e.subject === imported.id && e.detail.kept === 6))
 assert.ok(!JSON.stringify(await api('owner', 'audit?q=diagnosis.import')).includes('CUSTOMER SECRET'))
 assert.ok(unrelated)
}

async function browserProof(h, cookie, imports, withdrawn = false) {
 const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
 const { mkdir } = await import('node:fs/promises')
 const out = process.env.BEAM_DIAGNOSIS_EVIDENCE || 'test-results'
 await mkdir(out, { recursive: true })
 const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
 try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  await context.addCookies(cookie.split('; ').map(pair => { const i = pair.indexOf('='); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: h.origin, secure: true } }))
  const page = await context.newPage()
  for (const width of [1440, 390]) {
   await page.setViewportSize({ width, height: 1000 })
   for (const [i, id] of imports.entries()) {
    await page.goto(`${h.origin}/app/diagnoses?import=${id}`)
    if (withdrawn) await page.getByText('Withdrawn. This import is excluded from every later diagnosis.', { exact: true }).waitFor()
    else await page.getByRole('heading', { name: i === 0 ? 'Possible knowledge gap' : 'Investigate the process', exact: true }).waitFor()
    if (!withdrawn) { await page.getByText('Label the crate', { exact: true }).click(); await page.getByText('Apply the label before moving the crate.', { exact: true }).waitFor() }
    assert.ok(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth), 'no horizontal overflow')
    await page.screenshot({ path: `${out}/AGENT-002-${withdrawn ? 'withdrawn' : i === 0 ? 'knowledge' : 'process'}-${width}.png`, fullPage: true })
   }
   if (withdrawn) continue
   await page.goto(`${h.origin}/app/diagnoses`)
   if (!imports.length) { await page.getByText('No evidence imported yet.', { exact: true }).waitFor(); await page.screenshot({ path: `${out}/AGENT-002-empty-${width}.png`, fullPage: true }) }
   let browserFeed = null
   if (imports.length === 2) {
    await page.getByText('Authorize operational feed', { exact: true }).click()
    await page.getByLabel('Feed job role', { exact: true }).fill('Packing')
    await page.getByRole('checkbox', { name: 'Regression floor', exact: true }).check()
    await page.getByRole('checkbox', { name: 'I authorize minimized operational measures for this exact scope.', exact: true }).check()
    await page.screenshot({ path: `${out}/AGENT-001-authorize-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Authorize feed', exact: true }).click()
    browserFeed = (await h.api('error-feeds', cookie))[0].id
   }
   await page.getByText('Import error evidence', { exact: true }).click()
   await page.getByLabel('Job role', { exact: true }).fill('Packing')
   await page.screenshot({ path: `${out}/AGENT-002-import-${width}.png`, fullPage: true })
   if (imports.length === 2) {
    await page.getByLabel('Authorized feed (optional)', { exact: true }).selectOption(browserFeed)
    await page.getByLabel('Error metric', { exact: true }).fill('Browser packing audit')
    await page.getByLabel('Unit', { exact: true }).fill('errors / 100 crates')
    await page.getByLabel('Window start', { exact: true }).fill('2030-02-01')
    await page.getByLabel('Window end (inclusive)', { exact: true }).fill('2030-02-28')
    await page.getByLabel('Error CSV', { exact: true }).setInputFiles({ name: `browser-errors-${width}.csv`, mimeType: 'text/csv', buffer: Buffer.from('Employee ID,Date,Value\nDX1,2030-02-01,2\nDX2,2030-02-01,2\nDX3,2030-02-01,2') })
    await page.getByRole('button', { name: 'Import evidence', exact: true }).click()
    await page.getByRole('link', { name: `Browser packing audit · browser-errors-${width}.csv`, exact: true }).click()
    await page.getByRole('heading', { name: 'Evidence is uncertain', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Operational evidence', exact: true }).waitFor()
    assert.ok((await page.getByRole('button').allTextContents()).every(text => text.trim().length>0), 'every button has a visible text label')
    await page.screenshot({ path: `${out}/AGENT-001-imported-${width}.png`, fullPage: true })
    await page.locator(`form:has(input[name="feed"][value="${browserFeed}"])`).getByRole('button', { name: 'Revoke feed', exact: true }).click()
    await page.getByRole('link', { name: `Browser packing audit · browser-errors-${width}.csv`, exact: true }).click()
    await page.getByText('Withdrawn. This import is excluded from every later diagnosis.', { exact: true }).waitFor()
    await page.screenshot({ path: `${out}/AGENT-001-revoked-${width}.png`, fullPage: true })
   }
   await page.goto(`${h.origin}/app/agent`)
   await page.getByRole('link', { name: 'Compare error evidence', exact: true }).waitFor()
   await page.screenshot({ path: `${out}/AGENT-002-agent-${width}.png`, fullPage: true })
  }
  await context.close()
 } finally { await browser.close() }
}
