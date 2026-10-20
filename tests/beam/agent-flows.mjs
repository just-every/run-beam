// Clauses BEAM-17 to BEAM-20 through the same public doors as flows.mjs: the
// training report and its CSV, and the agent-prepared work a person approves.
// The agent is a real preparation credential issued from a manager's or
// author's ordinary session; no model is involved.
import assert from 'node:assert/strict'
import { file } from './harness.mjs'

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
    const records = await h.api(`report?course=${ids.records}`, people.manager)
    assert.ok(records.rows.some(row => row.learner === ids.lee && row.method === 'offline'))
    // Completed and expiring are separate statuses, as on Manage: each filter returns its own rows and the summary sums.
    for (const status of ['completed', 'expiring']) {
      const filtered = await h.api(`report?course=${ids.records}&status=${status}`, people.manager)
      assert.ok(filtered.rows.every(row => row.status === status))
      assert.equal(filtered.rows.length, records.summary[status])
    }
    assert.equal(records.summary.completed + records.summary.expiring + records.summary.overdue + records.summary.open, records.rows.filter(row => row.status !== 'cancelled').length)
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
    // OPS-001: the owner's audit and its export hold anonymous answers without the person or their words, and no practice run.
    const audit = await h.api('audit', people.owner)
    const answers = audit.events.filter(event => event.action === 'questions.answer')
    assert.ok(answers.length >= 5 && answers.every(event => event.actorName === 'Anonymous respondent' && JSON.stringify(event.detail) === '{}'))
    assert.ok(!audit.events.some(event => event.action.startsWith('practice.')))
    const exported = await (await h.raw('/app/audit.csv', { cookie: people.owner })).text()
    assert.ok(exported.includes('questions.answer') && !['Mornings are busy', 'Too tired at close', 'Nobody owns it'].some(words => exported.includes(words)))
  })

  // REPORT-005: a program with a drop-off, a retry and feedback, read as revision trends with effort and content age;
  // nothing is per person, and the private practice and anonymous answers above cannot be drilled into.
  await check('REPORT-005', async () => {
    const lessonsOf = async (cookie, assignment) => (await h.api(`assignments/${assignment}`, cookie)).lessons
    const made = await h.api('course.create', people.author, { title: 'Cold chain basics', reviewer: ids.reviewer })
    let draftVersion = made.draftVersion
    const edit = async (action, fields) => { draftVersion = (await h.api(action, people.author, { course: made.id, draftVersion, ...fields })).draftVersion }
    for (const title of ['Receiving', 'Storing', 'Logging']) await edit('course.lesson', { title, body: `${title} chilled stock.`, sources: [] })
    await edit('course.question', { prompt: 'Highest safe fridge temperature?', choices: '5 °C\n12 °C', correct: '1' })
    await edit('course.question', { prompt: 'Where is the log kept?', choices: 'On the fridge\nIn the office', correct: '1' })
    await edit('course.assessment', { passPercent: 100, maxAttempts: 3 })
    const first = (await h.api('course.submit', people.author, { course: made.id, draftVersion })).id
    await publish(first)
    const created = (await h.api('assignment.create', people.manager, { course: made.id, learners: [ids.sam, ids.lee], dueDate: '2030-05-01', dueTime: '17:00', timezone: 'UTC' })).created
    const mine = async cookie => (await h.api('records/me', cookie)).assignments.find(row => row.course === made.id && row.status === 'open').id
    const sam = await mine(people.sam), lee = await mine(people.lee)
    assert.ok(created.includes(sam) && created.includes(lee))
    for (const lesson of await lessonsOf(people.sam, sam)) await h.api('lesson.complete', people.sam, { assignment: sam, lesson: lesson.id })
    await h.api('lesson.complete', people.lee, { assignment: lee, lesson: (await lessonsOf(people.lee, lee))[0].id })
    const [q1, q2] = (await h.api(`assignments/${sam}`, people.sam)).quiz.questions
    assert.equal((await h.api('quiz.submit', people.sam, { assignment: sam, [`q_${q1.id}`]: ['1'], [`q_${q2.id}`]: ['0'] })).passed, false)
    assert.equal((await h.api('quiz.submit', people.sam, { assignment: sam, [`q_${q1.id}`]: ['0'], [`q_${q2.id}`]: ['0'] })).passed, true)
    await h.api('feedback.send', people.sam, { assignment: sam, kind: 'feedback', body: 'The log location is unclear.' })
    // A second revision continues the trend; its assignments start empty.
    await edit('course.lesson', { title: 'Cleaning', body: 'Clean the seals weekly.', sources: [] })
    await publish((await h.api('course.submit', people.author, { course: made.id, draftVersion })).id)

    await h.api('quality', people.sam, undefined, 403)
    assert.equal((await h.api(`quality?course=${made.id}&learner=${ids.sam}`, people.owner, undefined, 400)).error, 'individual_drilldown_refused')
    const view = await h.api(`quality?course=${made.id}`, people.owner)
    const [course] = view.courses
    assert.deepEqual(course.revisions.map(revision => [revision.number, revision.state, revision.enrollment.assigned]), [[1, 'superseded', 2], [2, 'published', 0]])
    const [one] = course.revisions
    assert.deepEqual(one.enrollment, { assigned: 2, completed: 1, open: 1, cancelled: 0 })
    assert.equal(one.completionDays.n, 1)
    assert.deepEqual(one.lessons.map(lesson => [lesson.completed, lesson.of, lesson.stoppedAfter]), [[2, 2, 1], [1, 2, 0], [1, 2, 0]])
    assert.equal(one.notStarted, 0)
    assert.deepEqual(one.questions.map(question => [question.answered, question.fullCredit]), [[2, 1], [2, 2]])
    assert.deepEqual(one.retries, { attempted: 1, retried: 1, passedAfterRetry: 1, attempts: 2 })
    assert.deepEqual(one.feedback, { feedback: 1, broken: 0 })
    assert.equal(one.survey, undefined)
    assert.deepEqual([course.effort.submitted, course.effort.published, course.effort.reviewHours.n, course.effort.timeSpent, course.contentAge.days], [2, 2, 2, null, 0])
    // A manager reads the same figures for one of their teams; a team outside their scope is refused.
    const team = await h.api(`quality?course=${made.id}&team=${ids.team}`, people.manager)
    assert.deepEqual(team.courses[0].revisions[0].lessons.map(lesson => lesson.completed), [2, 1, 1])
    await h.api(`quality?team=${(await h.api('team.create', people.owner, { name: 'Night shift' })).id}`, people.manager, undefined, 403)
    assert.equal((await h.raw('/app/quality', { cookie: people.manager })).status, 200)
    // The opening course holds Sam's practice runs and the anonymous answers: no person, run or answer appears.
    const opening = JSON.stringify(await h.api(`quality?course=${ids.opening}`, people.owner))
    for (const hidden of [ids.sam, ids.lee, 'Sam', 'The alarm is still armed.', 'Too tired at close.', 'Mornings are busy.']) assert.ok(!opening.includes(hidden), hidden)
    assert.ok(!JSON.stringify(view).includes(ids.sam) && !JSON.stringify(view).includes('The log location is unclear.'))
  })

  // AGENT-003: from a reviewed diagnosis of one role, the agent sets a minimal intervention beside the broad course;
  // the manager applies only the chosen option and people, and the decision keeps its lineage.
  await check('AGENT-003', async () => {
    const agent = await agentOf(people.manager)
    for (const person of [ids.sam, ids.lee]) await h.api('person.directory', people.owner, { member: person, jobRole: 'Front desk' })
    const diagnosis = (await h.api('diagnosis.record', people.manager, { title: 'Fridge log missed at opening', finding: 'Sam skipped the fridge log on 4 of 10 openings; Lee logged every one.', jobRole: 'Front desk', evidence: 'Opening checklists, 1-14 October' })).id
    const refresher = await h.api('course.create', people.author, { title: 'Fridge log refresher', reviewer: ids.reviewer })
    await publish((await h.api('course.submit', people.author, { course: refresher.id, draftVersion: (await h.api('course.lesson', people.author, { course: refresher.id, draftVersion: refresher.draftVersion, title: 'The log', body: 'Log the fridge temperature before opening.', sources: [] })).draftVersion })).id)
    const current = async id => (await h.api(`courses/${id}`, people.manager)).publishedRevision
    const due = { dueDate: '2030-07-01', dueTime: '17:00', timezone: 'UTC' }
    const options = [
      { id: 'refresher', kind: 'cohort_assignment', summary: 'Five-minute fridge log refresher for Sam', expectedBenefit: 'Sam logs the fridge at every opening', people: [ids.sam], paidMinutesPerPerson: 5, course: refresher.id, courseRevision: await current(refresher.id), ...due },
      { id: 'log-by-fridge', kind: 'process_change', summary: 'Keep the log on the fridge door', expectedBenefit: 'Nobody has to fetch the log', people: [], paidMinutesPerPerson: 0 },
      { id: 'everyone', kind: 'broad_course', summary: 'Retake Opening the clinic for the whole front desk', expectedBenefit: 'Everyone revisits every opening step', people: [ids.lee, ids.sam].sort(), paidMinutesPerPerson: 45, course: ids.opening, courseRevision: await current(ids.opening), ...due },
    ]
    const proposal = payload => ({ kind: 'intervention', title: 'Fridge log at opening', agent: 'claude-code', inputs: [{ type: 'diagnosis', id: diagnosis }], reasons: ['Only Sam misses the log; Lee does not.'], excluded: [{ item: 'Lee', reason: 'Logged every opening' }], payload })
    // Only a reviewed diagnosis, reviewed by someone else, can be the input.
    await agent('agent.propose', proposal({ diagnosis, options, recommended: 'refresher' }), 409)
    await h.api('diagnosis.review', people.manager, { diagnosis }, 403)
    await h.api('diagnosis.review', people.reviewer, { diagnosis })
    // The broad course is a compared alternative, never the recommendation, and covers the whole role.
    assert.equal((await agent('agent.propose', proposal({ diagnosis, options, recommended: 'everyone' }), 400)).error, 'broad_training_not_recommendable')
    assert.equal((await agent('agent.propose', proposal({ diagnosis, options: options.slice(0, 2), recommended: 'refresher' }), 400)).error, 'broad_alternative_required')
    assert.equal((await agent('agent.propose', proposal({ diagnosis, options: [{ ...options[0], people: [ids.author] }, ...options.slice(1)], recommended: 'refresher' }), 400)).error, 'person_outside_diagnosed_role')
    const made = await agent('agent.propose', proposal({ diagnosis, options, recommended: 'refresher' }))
    const detail = await h.api(`proposals/${made.id}`, people.manager)
    assert.deepEqual(detail.payload.options.map(option => [option.id, option.totalPaidMinutes, option.roles]), [['refresher', 5, ['Front desk']], ['log-by-fridge', 0, ['Front desk']], ['everyone', 90, ['Front desk']]])
    assert.ok((await pageOf('/app/agent', people.manager)).includes('name="option"'), 'the manager chooses the option on Agent work')
    // A changed payload is refused; the manager applies only the chosen option to the chosen people.
    await h.api('agent.decide', people.manager, { proposal: made.id, decision: 'approve', sha256: '0'.repeat(64), option: 'refresher' }, 409)
    await agent('agent.decide', { proposal: made.id, decision: 'approve', sha256: made.sha256 }, 403)
    const applied = await h.api('agent.decide', people.manager, { proposal: made.id, decision: 'approve', sha256: made.sha256, option: 'refresher', people: [ids.sam], note: 'Start with the refresher.' })
    assert.deepEqual([applied.result.diagnosis, applied.result.option, applied.result.people, applied.result.assignments.length, applied.result.totalPaidMinutes], [diagnosis, 'refresher', [ids.sam], 1, 5])
    const assigned = async cookie => (await h.api('records/me', cookie)).assignments.filter(row => row.course === refresher.id).length
    assert.deepEqual([await assigned(people.sam), await assigned(people.lee)], [1, 0])
    // Lineage: the decision names the reviewed diagnosis, the payload digest, the decider and the result.
    const lineage = await h.api(`proposals/${made.id}`, people.manager)
    assert.deepEqual([lineage.inputs.map(item => item.label), lineage.state, lineage.decidedBy, lineage.note, lineage.result.option], [['Reviewed diagnosis “Fridge log missed at opening”'], 'approved', ids.manager, 'Start with the refresher.', 'refresher'])
    assert.ok((await h.api('audit?q=agent.approve', people.owner)).events.some(event => event.subject === made.id && event.detail.sha256 === made.sha256))
  })

  // AGENT-005: the manager approves the measurement plan on the intervention page before deciding the intervention; scoped
  // outcomes with missing rows and a process change give a group comparison that names no one and claims no cause.
  await check('AGENT-005', async () => {
    const agent = await agentOf(people.manager)
    const roster = [['Employee ID', 'Name', 'Role', 'Team'], ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => [`E-70${n}`, `Dispenser ${n}`, 'Dispensary', 'Front desk']), ['E-709', 'Dispenser 9', 'Dispensary', '']]
    const created = (await h.api('people.import', people.owner, { file: file('roster.csv', roster.map(row => row.join(',')).join('\n'), 'text/csv') })).created
    assert.equal(created.length, 9)
    const [exposed, rest] = [created.slice(0, 4), created.slice(4)]
    const diagnosis = (await h.api('diagnosis.record', people.manager, { title: 'Dispensing checks missed', finding: 'Four dispensers skip the second check at busy times.', jobRole: 'Dispensary', evidence: 'Dispensing audit, January' })).id
    await h.api('diagnosis.review', people.reviewer, { diagnosis })
    const revision = (await h.api(`courses/${ids.opening}`, people.manager)).publishedRevision
    const due = { course: ids.opening, courseRevision: revision, dueDate: '2030-02-10', dueTime: '17:00', timezone: 'UTC' }
    const made = await agent('agent.propose', { kind: 'intervention', title: 'Second dispensing check', agent: 'claude-code', inputs: [{ type: 'diagnosis', id: diagnosis }], reasons: ['Only four dispensers miss the check.'], excluded: [], payload: { diagnosis, recommended: 'four', options: [
      { id: 'four', kind: 'cohort_assignment', summary: 'Refresher for the four', expectedBenefit: 'Fewer missed checks', people: exposed, paidMinutesPerPerson: 20, ...due },
      { id: 'all', kind: 'broad_course', summary: 'Everyone in the dispensary', expectedBenefit: 'Everyone revisits the check', people: [...created].sort(), paidMinutesPerPerson: 45, ...due },
    ] } })
    // The agent may prepare the plan; only a person approves it, and only while the intervention still waits.
    const plan = { intervention: made.id, metric: 'Missed second checks', unit: 'misses per 100 scripts', direction: 'lower', baselineFrom: '2030-01-01', baselineTo: '2030-01-31', afterFrom: '2030-03-01', afterTo: '2030-03-31', comparison: 'rest_of_role', minGroup: 3 }
    assert.equal((await agent('outcome.plan', { ...plan, baselineTo: '2030-03-05' }, 400)).error, 'baseline_must_precede_after')
    const prepared = (await agent('outcome.plan', plan)).id
    await agent('outcome.approve', { plan: prepared }, 403)
    const waiting = await pageOf('/app/agent', people.manager)
    assert.ok(waiting.includes('Measuring the outcome') && waiting.includes('Approve this measurement plan') && waiting.includes('Missed second checks'))
    assert.equal((await h.submit('outcome.approve', people.manager, { plan: prepared }, '/app/agent')).searchParams.get('notice'), 'Saved.')
    assert.equal((await h.api('outcome.import', people.manager, { plan: prepared, csv: 'Employee ID,Date,Value\nE-701,2030-01-05,6' }, 409)).error, 'intervention_not_applied')
    await h.api('agent.decide', people.manager, { proposal: made.id, decision: 'approve', sha256: made.sha256, option: 'four' })
    assert.equal((await h.api('outcome.plan', people.manager, plan, 409)).error, 'intervention_already_decided')
    assert.ok((await pageOf('/app/agent?state=approved', people.manager)).includes('action="/app/do/outcome.import"'))
    // Scoped import: E-709 is outside the manager's teams, E-999 is nobody, one row is outside both periods, one value is blank.
    const csv = ['Employee ID,Date,Value', 'E-701,2030-01-10,6', 'E-702,2030-01-10,5', 'E-703,2030-01-10,7', 'E-704,2030-01-10,6', 'E-701,2030-03-10,2', 'E-702,2030-03-10,3', 'E-703,2030-03-10,2', 'E-704,2030-03-10,',
      'E-705,2030-01-12,6', 'E-706,2030-01-12,6', 'E-707,2030-01-12,5', 'E-708,2030-01-12,7', 'E-705,2030-03-12,5', 'E-706,2030-03-12,6', 'E-707,2030-03-12,5', 'E-709,2030-01-12,6', 'E-999,2030-01-12,4', 'E-701,2030-02-15,1'].join('\n')
    const imported = await h.api('outcome.import', people.manager, { plan: prepared, file: file('outcomes.csv', csv, 'text/csv'), processChanges: '2030-02-20 New dispensing checklist for all staff' })
    assert.deepEqual([imported.stored, imported.blank, imported.processChanges, imported.refused], [14, 1, 1, [{ line: 17, reason: 'outside_your_people' }, { line: 18, reason: 'unknown_employee' }, { line: 19, reason: 'outside_periods' }]])
    const view = await h.api(`outcomes/${prepared}`, people.manager)
    assert.deepEqual([view.exposed.people, view.exposed.paired, view.exposed.missingAfter, view.exposed.before, view.exposed.after, view.exposed.change, view.exposed.interval], [4, 3, 1, 6, 2.33, -3.67, [-5.4, -1.94]])
    assert.deepEqual([view.comparisonGroup.people, view.comparisonGroup.paired, view.comparisonGroup.missingBefore, view.comparisonGroup.missingAfter, view.comparisonGroup.change], [5, 3, 1, 2, -0.33])
    assert.deepEqual([view.difference.value, view.difference.interval], [-3.33, [-5.18, -1.49]])
    assert.deepEqual(view.confounders, [{ date: '2030-02-20', description: 'New dispensing checklist for all staff' }])
    assert.ok(view.limits.some(limit => limit.startsWith('Missing data')) && view.limits.some(limit => limit.startsWith('Small sample')))
    assert.ok(view.reading.includes('does not show cause') && view.causation.includes('Completion proves neither competence nor causation'))
    // No person's value, id or rank is ever returned, and a per-person or ranked read is refused.
    assert.ok(created.every(id => !JSON.stringify(view).includes(id)))
    assert.equal((await h.api(`outcomes/${prepared}?rank=change`, people.manager, undefined, 400)).error, 'individual_results_refused')
    await h.api(`outcomes/${prepared}`, people.sam, undefined, 403)
    // Readers are the owner, the approving manager and managers whose teams include cohort people.
    await h.api('person.invite', people.owner, { email: 'mia@example.test', name: 'Mia Chen', roles: ['manager', 'learner'] })
    await h.api(`outcomes/${prepared}`, await h.signIn('mia@example.test', { requested: true }), undefined, 403)
    assert.equal((await h.api(`outcomes/${prepared}`, people.owner)).difference.value, -3.33)
    // A later plan whose groups differ from this plan's by fewer people than the bound shows neither group nor difference.
    const again = await agent('agent.propose', { kind: 'intervention', title: 'Second check, three people', agent: 'claude-code', inputs: [{ type: 'diagnosis', id: diagnosis }], reasons: ['Three still miss it.'], excluded: [], payload: { diagnosis, recommended: 'three', options: [
      { id: 'three', kind: 'cohort_assignment', summary: 'Refresher for three', expectedBenefit: 'Fewer missed checks', people: created.slice(0, 3), paidMinutesPerPerson: 20, ...due },
      { id: 'all', kind: 'broad_course', summary: 'Everyone in the dispensary', expectedBenefit: 'Everyone revisits the check', people: [...created].sort(), paidMinutesPerPerson: 45, ...due },
    ] } })
    const second = (await h.api('outcome.plan', people.manager, { ...plan, intervention: again.id })).id
    await h.api('outcome.approve', people.manager, { plan: second })
    await h.api('agent.decide', people.manager, { proposal: again.id, decision: 'approve', sha256: again.sha256, option: 'three' })
    await h.api('outcome.import', people.manager, { plan: second, csv })
    const differenced = await h.api(`outcomes/${second}`, people.manager)
    assert.deepEqual([differenced.exposed.hidden, differenced.exposed.reason, differenced.comparisonGroup.reason, differenced.difference, differenced.exposed.change], [true, 'differs_from_earlier_plan', 'differs_from_earlier_plan', null, undefined])
    const page = await pageOf('/app/agent?state=approved', people.manager)
    assert.ok(page.includes('Difference in change: -3.33') && page.includes('New dispensing checklist for all staff') && page.includes('does not show that the intervention caused any change'))
  })
}
