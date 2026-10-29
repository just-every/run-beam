import { randomUUID } from 'node:crypto'
import { prepareCourse } from './course-fixture.mjs'
import { installation, nativeHttp } from './native.mjs'
import { prepareDiagnosis, prepareQuestions, prepareWork } from './work-fixture.mjs'

// Each policy round receives fresh native course, source, proposal, question,
// diagnosis and intervention records. Human identities are stable live members;
// their cookies remain private to these test modules and never become values.
export default async function prepareFixtures(context) {
  if (context.phase === 'initial') return { values: {}, clients: {} }
  const state = installation(context.origin)
  const label = `${context.phase.replaceAll(':', '-')} ${randomUUID().slice(0, 8)}`
  const [content, questions] = await Promise.all([
    prepareCourse(context, state, label),
    prepareQuestions(context, state, label),
  ])
  const [diagnosis, path] = await Promise.all([
    prepareDiagnosis(context, state, content.course, questions, label),
    preparePath(context, state, content.course, label),
  ])
  const work = await prepareWork(context, state, content.course, content.source, questions, diagnosis, label)
  return {
    clients: {},
    values: {
      identity: { owner: state.owner, reviewer: state.reviewer.id, learners: state.learners.map(person => person.id), team: state.team, jobRole: state.jobRole },
      ...content, ...work, questions: { id: questions.id },
      diagnosis: diagnosis.diagnosis, intervention: diagnosis.intervention, outcome: diagnosis.outcome, path: { id: path.id },
      draftProposal: {
        course: content.course.id, draftVersion: content.course.draftVersion,
        summary: 'Clarify where the dispatch log is kept before the next human review.',
        draft: { ...content.course.draft, summary: 'Check temperature and keep the dispatch log beside the packing bench.' },
        inputs: [content.source.versionId],
        passages: [{ sourceVersion: content.source.versionId, quote: 'Record the reading in the dispatch log.', lesson: 'Check the cold room' }], missing: [],
      },
    },
  }
}

async function preparePath(context, state, course, label) {
  const http = nativeHttp(context)
  const path = await http.api('path.create', { name: `Packing induction ${label}`, team: state.team })
  await http.api('path.revise', { path: path.id, courses: [course.id], prerequisites: [''], dueDays: ['14'], renewalDays: ['365'] })
  return path
}
