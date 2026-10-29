import { futureDay, nativeHttp, requireThat } from './native.mjs'

const reason = 'Review minimized operational evidence and staff concerns before selecting any intervention.'
export const preparation = (kind, title, payload, inputs = []) => ({ kind, title, inputs, reasons: [reason], excluded: [], payload })

export async function prepareQuestions(context, state, label) {
  const http = nativeHttp(context)
  const payload = {
    title: `Cold-chain work questions ${label}`, purpose: 'Find unclear instructions and obstacles during paid packing work.',
    questions: ['What makes it difficult to check temperature before dispatch?'],
    participants: state.learners.map(person => person.id), closesOn: futureDay(30),
  }
  const proposed = await http.api('agent.propose', preparation('question_plan', payload.title, payload))
  const decision = await http.api('agent.decide', { proposal: proposed.id, decision: 'approve', sha256: proposed.sha256 })
  const id = decision.result.plan
  await Promise.all(state.learners.map((person, index) =>
    nativeHttp({ ...context, cookie: person.cookie }).api('questions.answer', {
      plan: id, answer1: [
        'The thermometer is far from the dispatch bench.',
        'The dispatch log is difficult to find during the shift.',
        'A fixed place for the thermometer and log would help.',
      ][index],
    }),
  ))
  await http.api('questions.close', { plan: id })
  const released = await http.api(`questions/${id}`)
  requireThat(released.hidden === null && released.answers?.length === 3, 'Native staff answers did not pass the privacy boundary')
  return { id, payload }
}

export async function prepareDiagnosis(context, state, course, questions, label) {
  const http = nativeHttp(context)
  const csv = 'Employee ID,Date,Value\n' + state.learners.map((person, index) => `${person.employeeId},2025-01-15,${index + 2}`).join('\n')
  const imported = await http.api('outcome.import', {
    purpose: 'diagnosis', course: course.id, jobRole: state.jobRole,
    metric: 'Cold-chain holds per 100 crates', unit: 'holds / 100 crates',
    from: '2025-01-01', to: '2025-01-31', questionPlan: questions.id, csv,
  })
  requireThat(imported.kept === 3 && !imported.refused.length, 'Native diagnosis import did not retain its minimized evidence')
  const diagnosis = await http.api('diagnosis.prepare', { import: imported.id })
  await nativeHttp({ ...context, cookie: state.reviewer.cookie }).api('diagnosis.review', { diagnosis: diagnosis.id })
  const due = { course: course.id, courseRevision: course.revision, dueDate: futureDay(45), dueTime: '17:00', timezone: 'UTC' }
  const payload = {
    diagnosis: diagnosis.id, recommended: 'process', options: [
      { id: 'process', kind: 'process_change', summary: 'Place the thermometer and dispatch log beside the packing bench.', expectedBenefit: 'Make each check practical before dispatch.', people: state.learners.map(person => person.id), paidMinutesPerPerson: 5 },
      { id: 'broad', kind: 'broad_course', summary: 'Repeat the full cold-chain induction for every packing operator.', expectedBenefit: 'Compare the effort of broad training before choosing a smaller response.', people: state.learners.map(person => person.id), paidMinutesPerPerson: 25, ...due },
    ],
  }
  const args = preparation('intervention', `Cold-chain intervention alternatives ${label}`, payload, [{ type: 'diagnosis', id: diagnosis.id }])
  const waiting = await http.api('agent.propose', args)
  return {
    diagnosis: { import: imported.id, id: diagnosis.id, intervention: waiting.id, jobRole: state.jobRole },
    intervention: { id: waiting.id, sha256: waiting.sha256, payload },
    args,
    outcome: {
      intervention: waiting.id, metric: 'Cold-chain holds', unit: 'holds / 100 crates', direction: 'lower',
      baselineFrom: '2025-01-01', baselineTo: '2025-01-31', afterFrom: '2025-02-01', afterTo: '2025-02-28', comparison: 'none', minGroup: 3,
    },
  }
}

export async function prepareWork(context, state, course, source, questions, diagnosis, label) {
  const http = nativeHttp(context)
  const due = { course: course.id, courseRevision: course.revision, dueDate: futureDay(45), dueTime: '17:00', timezone: 'UTC' }
  const assignments = await http.api('assignment.create', { course: course.id, learners: [state.learners[0].id], dueDate: due.dueDate, dueTime: due.dueTime, timezone: due.timezone })
  requireThat(assignments.created.length === 1, 'Native preparation assignment was not fresh')
  const process = preparation('process_change', `Dispatch station improvement ${label}`, {
    summary: 'Keep the dispatch tools together.', change: 'Place the thermometer and log beside the packing bench during the paid shift.', questionPlan: questions.id,
  }, [{ type: 'question_plan', id: questions.id }])
  const proposal = await http.api('agent.propose', process)
  return {
    proposal, assignment: { id: assignments.created[0] },
    preparations: {
      assignment_plan: preparation('assignment_plan', `Targeted induction plan ${label}`, { items: [{ learner: state.learners[1].id, ...due }] }, [{ type: 'course_revision', id: course.revision }]),
      reminders: preparation('reminders', `Paid-work reminder ${label}`, { items: [{ assignment: assignments.created[0], message: 'Please arrange paid time with your shift lead to complete the cold-chain induction.' }] }, [{ type: 'assignment', id: assignments.created[0] }]),
      question_plan: preparation('question_plan', `Follow-up questions ${label}`, { ...questions.payload, title: `Follow-up cold-chain questions ${label}` }),
      process_change: process,
      intervention: diagnosis.args,
      scenario: preparation('scenario', `Dispatch practice ${label}`, {
        course: course.id, courseRevision: course.revision, title: 'A warm chilled crate', rubric: 'Hold produce outside the approved temperature range and ask the shift lead to inspect it.',
        steps: [{ id: 'dispatch', situation: 'A chilled crate reads 8 C before dispatch. What do you do?', choices: [
          { label: 'Hold the crate and ask the shift lead.', feedback: 'Hold crates outside the approved range before dispatch.', next: null, sources: [source.versionId] },
          { label: 'Dispatch it without recording the reading.', feedback: 'Record the reading and hold the crate for review.', next: null, sources: [source.versionId] },
        ] }],
      }, [{ type: 'course_revision', id: course.revision }, { type: 'source_version', id: source.versionId }]),
    },
  }
}
