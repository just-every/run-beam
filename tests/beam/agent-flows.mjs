// Clauses BEAM-17 to BEAM-20 through the same public doors as flows.mjs: the
// training report and its CSV, and the agent-prepared work a person approves.
// The agent is a real preparation credential issued from a manager's or
// author's ordinary session; no model is involved.
import assert from 'node:assert/strict'

export async function agentFlows({ h, check, people, ids, publish }) {
  const agentOf = async cookie => {
    const { token } = await h.api('agent.issue', cookie, { expiresInSeconds: 900 })
    return async (path, body, status = 200) => {
      const response = await h.fetch(`/api/beam/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { origin: h.origin, 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) })
      const text = await response.text()
      assert.equal(response.status, status, `${path}: ${response.status} ${text.slice(0, 300)}`)
      return text ? JSON.parse(text) : null
    }
  }
  const pageOf = async (path, cookie) => { const response = await h.raw(path, { cookie }); assert.equal(response.status, 200, path); return await response.text() }

  await check('BEAM-17', async () => {
    await h.api('report', people.sam, undefined, 403)
    assert.equal((await h.raw('/app/reports.csv', { cookie: people.sam })).status, 403)
    const report = await h.api(`report?course=${ids.opening}`, people.manager)
    const sam = report.rows.filter(row => row.learner === ids.sam)
    const completed = sam.find(row => row.revision === ids.openingRev2)
    assert.deepEqual([completed.status, completed.method, completed.quizAttempts, completed.quizPassed, completed.practical.state, completed.practical.assessor], ['completed', 'assessed', 3, 1, 'accepted', 'Tom Okafor'])
    assert.ok(completed.certificate)
    assert.ok(sam.some(row => row.revision === ids.openingRev3 && row.status === 'open'), 'the reassignment to revision 3 is its own row')
    assert.ok(report.rows.every(row => row.course === ids.opening))
    // Offline attendance is reported, and team and status filters narrow the rows.
    const records = await h.api(`report?course=${ids.records}&status=completed`, people.manager)
    assert.ok(records.rows.some(row => row.learner === ids.lee && row.method === 'offline'))
    assert.ok(records.rows.every(row => row.status === 'completed' || row.status === 'expiring'))
    const overdue = await h.api('report?status=overdue', people.manager)
    assert.ok(overdue.rows.length > 0 && overdue.rows.every(row => row.status === 'overdue'))
    assert.equal(overdue.summary.overdue, overdue.rows.length)
    const team = await h.api(`report?team=${ids.team}`, people.manager)
    assert.ok(team.rows.every(row => [ids.sam, ids.lee].includes(row.learner)))
    await h.api('report?status=everything', people.manager, undefined, 400)
    // The CSV holds the same rows as the page, one line each after the header.
    const csv = await h.raw(`/app/reports.csv?course=${ids.opening}`, { cookie: people.manager })
    assert.match(csv.headers.get('content-type'), /^text\/csv/)
    assert.match(csv.headers.get('content-disposition'), /attachment/)
    const lines = (await csv.text()).trim().split('\r\n')
    assert.equal(lines.length, report.rows.length + 1)
    assert.ok(lines.some(line => line.includes(completed.certificate) && line.includes(ids.openingRev2)))
    const html = await pageOf(`/app/reports?course=${ids.opening}`, people.manager)
    assert.ok(html.includes(completed.certificate))
  })

  await check('BEAM-18', async () => {
    // A manager's agent prepares a targeted plan from the front-desk path.
    const agent = await agentOf(people.manager)
    const paths = await agent('paths')
    const plan = {
      kind: 'assignment_plan', title: 'Front desk handbook for Lee', agent: 'claude-code',
      inputs: [{ type: 'path_revision', id: paths[0].revision }, { type: 'course_revision', id: (await h.api(`courses/${ids.records}`, people.manager)).publishedRevision }],
      reasons: ['Lee now covers the front desk on Fridays.'], excluded: [{ item: 'Opening the clinic', reason: 'Lee already has an open assignment.' }],
      payload: { items: [{ learner: ids.lee, course: ids.records, courseRevision: (await h.api(`courses/${ids.records}`, people.manager)).publishedRevision, dueDate: '2030-04-01', dueTime: '17:00', timezone: 'Australia/Sydney' }] },
    }
    await agent('agent.propose', { ...plan, payload: { items: [{ ...plan.payload.items[0], courseRevision: ids.openingRev2, course: ids.opening }] } }, 409)
    // Lee's renewal for records is open, so plan a course Lee holds no open assignment for.
    const handbook = await h.api('course.create', people.author, { title: 'Front desk handbook', summary: '', reviewer: ids.reviewer })
    const lesson = await h.api('course.lesson', people.author, { course: handbook.id, draftVersion: handbook.draftVersion, title: 'Phones', body: 'Answer within three rings.', sources: [] })
    const first = await h.api('course.submit', people.author, { course: handbook.id, draftVersion: lesson.draftVersion })
    await publish(first.id)
    plan.payload.items[0] = { ...plan.payload.items[0], course: handbook.id, courseRevision: first.id }
    const proposed = await agent('agent.propose', plan)
    assert.ok(!(await h.api('records/me', people.lee)).assignments.some(row => row.course === handbook.id), 'nothing is assigned before approval')
    // The agent cannot decide, nor can people without authority; the decision binds the reviewed payload.
    await agent('agent.decide', { proposal: proposed.id, decision: 'approve', sha256: proposed.sha256 }, 403)
    await h.api('agent.decide', people.author, { proposal: proposed.id, decision: 'approve', sha256: proposed.sha256 }, 403)
    await h.api('agent.decide', people.manager, { proposal: proposed.id, decision: 'approve', sha256: '0'.repeat(64) }, 409)
    const listed = (await agent('proposals')).find(row => row.id === proposed.id)
    assert.deepEqual([listed.agent, listed.viaAgent, listed.inputs.length, listed.excluded[0].item], ['claude-code', true, 2, 'Opening the clinic'])
    assert.ok((await pageOf('/app/agent', people.manager)).includes('Front desk handbook for Lee'))
    const approved = await h.submit('agent.decide', people.manager, { proposal: proposed.id, decision: 'approve', sha256: proposed.sha256, note: 'Yes, before April.' }, '/app/agent')
    assert.equal(approved.searchParams.get('error'), null)
    const decided = await h.api(`proposals/${proposed.id}`, people.manager)
    assert.deepEqual([decided.state, decided.decidedBy, decided.note, decided.result.created.length], ['approved', ids.manager, 'Yes, before April.', 1])
    const assigned = (await h.api('records/me', people.lee)).assignments.find(row => row.course === handbook.id)
    assert.equal((await h.api(`assignments/${assigned.id}`, people.lee)).assignment.revision, first.id)
    await h.api('agent.decide', people.manager, { proposal: proposed.id, decision: 'approve', sha256: proposed.sha256 }, 409)
    // A plan prepared against a revision that has since been superseded is refused, not silently re-pointed.
    const stalePlan = await agent('agent.propose', { ...plan, title: 'Handbook for Sam', payload: { items: [{ ...plan.payload.items[0], learner: ids.sam }] } })
    const draft = (await h.api(`courses/${handbook.id}`, people.author)).draftVersion
    await publish((await h.api('course.submit', people.author, { course: handbook.id, draftVersion: draft })).id)
    await h.api('agent.decide', people.manager, { proposal: stalePlan.id, decision: 'approve', sha256: stalePlan.sha256 }, 409)
    assert.equal((await h.api(`proposals/${stalePlan.id}`, people.manager)).state, 'waiting')
    await h.api('agent.decide', people.manager, { proposal: stalePlan.id, decision: 'decline', sha256: stalePlan.sha256, note: 'Revision 2 is out.' })
    // Reminder drafts reach the learner only once approved, and only for open work.
    const reminder = await agent('agent.propose', { kind: 'reminders', title: 'Handbook nudge', agent: 'claude-code', reasons: ['Due in April.'], payload: { items: [{ assignment: assigned.id, message: 'Please finish the handbook during your Friday shift.' }] } })
    assert.deepEqual(await h.api('messages', people.lee), [])
    await h.api('agent.decide', people.manager, { proposal: reminder.id, decision: 'approve', sha256: reminder.sha256 })
    const messages = await h.api('messages', people.lee)
    assert.deepEqual(messages.map(row => [row.body, row.approvedBy]), [['Please finish the handbook during your Friday shift.', 'Tom Okafor']])
    assert.ok((await pageOf('/app', people.lee)).includes('Please finish the handbook during your Friday shift.'))
    assert.deepEqual(await h.api('messages', people.sam), [])
    // Course-draft proposals show the source passages they rely on and what is missing.
    const course = await h.api(`courses/${ids.opening}`, people.author)
    const sourceVersion = course.draft.lessons[1].sources[0]
    const draftProposal = { course: ids.opening, draftVersion: course.draftVersion, summary: 'Tighten the fridge step', agent: 'claude-code', inputs: [sourceVersion], draft: course.draft, passages: [{ sourceVersion, quote: 'Record the fridge temperature.', lesson: 'Opening steps' }], missing: ['Which thermometer to use'] }
    const authorAgent = await agentOf(people.author)
    await authorAgent('proposal.create', { ...draftProposal, passages: [{ sourceVersion: ids.sourceV1, quote: 'x' }] }, 400)
    const made = await authorAgent('proposal.create', draftProposal)
    const shown = (await h.api(`courses/${ids.opening}`, people.reviewer)).proposals.find(row => row.id === made.id)
    assert.deepEqual([shown.passages[0].quote, shown.missing], ['Record the fridge temperature.', ['Which thermometer to use']])
    assert.ok((await pageOf(`/app/courses/${ids.opening}`, people.reviewer)).includes('Which thermometer to use'))
  })

  await check('BEAM-19', async () => {
    const agent = await agentOf(people.manager)
    const tomorrow = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
    const payload = { title: 'How opening works in practice', purpose: 'Find out why the fridge log is missed.', questions: ['What gets in the way of the fridge log?', 'What would help?'], participants: [ids.sam, ids.lee, ids.author, ids.reviewer], closesOn: tomorrow }
    const proposed = await agent('agent.propose', { kind: 'question_plan', title: payload.title, agent: 'claude-code', reasons: ['Fridge log missed on 4 mornings.'], payload })
    assert.ok(!(await pageOf('/app', people.sam)).includes(payload.title), 'nobody is asked before approval')
    const approved = await h.api('agent.decide', people.manager, { proposal: proposed.id, decision: 'approve', sha256: proposed.sha256 })
    const plan = approved.result.plan
    assert.ok((await pageOf('/app', people.sam)).includes(payload.title))
    await h.api(`questions/${plan}`, people.manager)
    await h.api(`questions/${plan}`, people.owner)
    // Someone not asked cannot read the plan; answering is optional and once only.
    const invitee = (await h.api(`questions/${plan}`, people.sam))
    assert.equal(invitee.answers, undefined)
    await h.api('questions.answer', people.sam, { plan, answer1: 'Mornings are busy.', answer2: 'A reminder on the fridge.' })
    await h.api('questions.answer', people.sam, { plan, answer1: 'Again' }, 409)
    await h.api('questions.decline', people.lee, { plan })
    await h.api('questions.answer', people.author, { plan, answer1: 'The log is in the back room.' })
    // Answers stay hidden while open, and hidden after closing when too few answered.
    let view = await agent(`questions/${plan}`)
    assert.deepEqual([view.answers, view.hidden, view.participation.answered, view.participation.declined], [null, 'still_open', 2, 1])
    await h.api('questions.close', people.sam, { plan }, 403)
    await h.api('questions.close', people.manager, { plan })
    view = await agent(`questions/${plan}`)
    assert.deepEqual([view.answers, view.hidden], [null, 'too_few_answers'])
    await h.api('questions.answer', people.reviewer, { plan, answer1: 'Late' }, 409)
    // A second plan with enough answers releases them, without names and in no order.
    const second = await agent('agent.propose', { kind: 'question_plan', title: 'Closing the clinic', agent: 'claude-code', reasons: ['Closing checklist skipped.'], payload: { ...payload, title: 'Closing the clinic', participants: [ids.sam, ids.lee, ids.author] } })
    const secondPlan = (await h.api('agent.decide', people.manager, { proposal: second.id, decision: 'approve', sha256: second.sha256 })).result.plan
    await h.api(`questions/${secondPlan}`, people.reviewer, undefined, 404)
    for (const [person, answer] of [['sam', 'Too tired at close.'], ['lee', 'Nobody owns it.'], ['author', 'The checklist is long.']]) await h.api('questions.answer', people[person], { plan: secondPlan, answer1: answer })
    await h.api('questions.close', people.manager, { plan: secondPlan })
    view = await agent(`questions/${secondPlan}`)
    assert.deepEqual(view.answers.map(answers => answers[0]).sort(), ['Nobody owns it.', 'The checklist is long.', 'Too tired at close.'])
    assert.ok(!JSON.stringify(view).includes(ids.sam) && !JSON.stringify(view.answers).includes('Sam'), 'answers carry no person')
    // The agent proposes a process change from the answers; the manager's decision is recorded.
    const change = await agent('agent.propose', { kind: 'process_change', title: 'Name a closing owner', agent: 'claude-code', inputs: [{ type: 'question_plan', id: secondPlan }], reasons: ['Two of three answers point at ownership, not skill.'], excluded: [{ item: 'Retraining on closing', reason: 'Answers do not show a knowledge gap.' }], payload: { summary: 'Roster a closing owner each day', change: 'Add a closing owner to the daily roster.', questionPlan: secondPlan } })
    const recorded = await h.api('agent.decide', people.manager, { proposal: change.id, decision: 'approve', sha256: change.sha256 })
    assert.deepEqual(recorded.result, { recorded: true })
    assert.ok((await agent('proposals?state=approved')).some(row => row.id === change.id && row.decidedBy === ids.manager))
  })

  await check('BEAM-20', async () => {
    const authorAgent = await agentOf(people.author)
    const course = await h.api(`courses/${ids.opening}`, people.author)
    const revision = await h.api(`revisions/${course.publishedRevision}`, people.author)
    const cited = revision.lessons.flatMap(lesson => lesson.sources)[0]
    const steps = [
      { id: 'door', situation: 'A patient knocks before opening.', choices: [{ label: 'Let them in', feedback: 'The alarm is still armed.', next: 'alarm' }, { label: 'Keep the door locked', feedback: 'Right: disarm and check the fridge first.', next: null, sources: [cited] }] },
      { id: 'alarm', situation: 'The alarm starts sounding.', choices: [{ label: 'Disarm it', feedback: 'Then check the fridge log.', next: null }, { label: 'Ignore it', feedback: 'Disarm it first.', next: null }] },
    ]
    const scenario = { kind: 'scenario', title: 'A patient arrives early', agent: 'claude-code', reasons: ['Practise the door step.'], payload: { course: ids.opening, courseRevision: course.publishedRevision, title: 'A patient arrives early', rubric: 'Door stays locked until the alarm is off and the fridge log is checked.', steps } }
    await authorAgent('agent.propose', { ...scenario, payload: { ...scenario.payload, steps: [{ ...steps[0], choices: [{ ...steps[0].choices[0], next: 'nowhere' }, steps[0].choices[1]] }] } }, 400)
    await authorAgent('agent.propose', { ...scenario, payload: { ...scenario.payload, steps: [{ ...steps[0], choices: [steps[0].choices[1], { ...steps[0].choices[1], sources: ['not-cited'] }] }] } }, 400)
    const proposed = await authorAgent('agent.propose', scenario)
    // Deployment is the course's named reviewer's decision, not the author's or a manager's.
    await h.api('agent.decide', people.author, { proposal: proposed.id, decision: 'approve', sha256: proposed.sha256 }, 403)
    await h.api('agent.decide', people.manager, { proposal: proposed.id, decision: 'approve', sha256: proposed.sha256 }, 403)
    const deployed = (await h.api('agent.decide', people.reviewer, { proposal: proposed.id, decision: 'approve', sha256: proposed.sha256 })).result.scenario
    // Sam is assigned the current revision and practises.
    const samAssignment = (await h.api('records/me', people.sam)).assignments.find(row => row.course === ids.opening && row.status === 'open')
    assert.ok((await pageOf(`/app/learn/${samAssignment.id}`, people.sam)).includes(`/app/practice/${deployed}`))
    const before = await h.api('records/me', people.sam)
    let view = await h.api(`practice/${deployed}`, people.sam)
    assert.deepEqual([view.step.id, view.feedback], ['door', null])
    await h.api('practice.choose', people.sam, { scenario: deployed, step: 'door', choice: 0 })
    view = await h.api(`practice/${deployed}`, people.sam)
    assert.deepEqual([view.step.id, view.feedback.text], ['alarm', 'The alarm is still armed.'])
    await h.api('practice.choose', people.sam, { scenario: deployed, step: 'door', choice: 1 }, 409)
    await h.api('practice.choose', people.sam, { scenario: deployed, step: 'alarm', choice: 0 })
    view = await h.api(`practice/${deployed}`, people.sam)
    assert.equal(view.finished, true)
    await h.api('practice.restart', people.sam, { scenario: deployed })
    view = await h.api(`practice/${deployed}`, people.sam)
    assert.equal(view.step.id, 'door')
    await h.submit('practice.choose', people.sam, { scenario: deployed, step: 'door', choice: '1' }, `/app/practice/${deployed}`)
    view = await h.api(`practice/${deployed}`, people.sam)
    assert.deepEqual([view.finished, view.feedback.sources.length], [true, 1])
    assert.ok((await pageOf(`/app/practice/${deployed}`, people.sam)).includes('does not count toward completion'))
    // Practice never scores or completes anything.
    const after = await h.api('records/me', people.sam)
    assert.deepEqual([after.completions.length, after.assignments.map(row => row.status)], [before.completions.length, before.assignments.map(row => row.status)])
    assert.equal((await h.api(`assignments/${samAssignment.id}`, people.sam)).attempts.length, 0)
    // Someone without an assignment for that revision cannot open it; nobody else sees Sam's runs.
    await h.api(`practice/${deployed}`, people.reviewer, undefined, 404)
  })
}
