import { file, nativeHttp, requireThat } from './native.mjs'

export const procedure = 'Check the cold-room thermometer before moving produce.\nKeep chilled crates below 5 C.\nRecord the reading in the dispatch log.'
const changedProcedure = procedure.replace('below 5 C', 'below 4 C')

export async function prepareCourse(context, state, label) {
  const http = nativeHttp(context)
  const [source, created] = await Promise.all([
    http.api('source.create', {
      title: `Sierra Lakes cold-chain procedure ${label}`, licence: 'owned',
      licenceEvidence: 'Synthetic employer-owned procedure for the contained conformance installation.',
      reviewer: state.reviewer.id, provenance: 'Sierra Lakes packing floor, approved dispatch procedure',
      file: file('sierra-lakes-cold-chain.txt', procedure),
    }),
    http.api('course.create', {
      title: `Sierra Lakes cold-chain induction ${label}`,
      summary: 'Check temperature, hold unsafe produce and retain the dispatch record during paid work.', reviewer: state.reviewer.id,
    }),
  ])
  const download = await http.fetch(`/app/files/source/${source.versionId}?download=1`)
  requireThat(download.status === 200 && await download.text() === procedure, 'Native immutable source download differed from the uploaded procedure')
  let current = created
  const edit = async (action, fields) => {
    current = await http.api(action, { course: created.id, draftVersion: current.draftVersion, ...fields })
    return current
  }
  await edit('course.lesson', { title: 'Check the cold room', body: procedure, sources: [source.versionId] })
  const lesson = current.draft.lessons[0].id
  await edit('course.lesson', { title: 'Hold and escalate', body: 'Hold crates with unsafe readings. Ask the shift lead to inspect them before dispatch.', sources: [source.versionId] })
  await edit('course.lesson', { title: 'Retain the dispatch log', body: 'Keep each temperature reading beside its crate number in the dispatch log.', sources: [source.versionId] })
  await edit('course.block', { lesson, content: { kind: 'text', text: '**Before dispatch**, read and record the thermometer.' } })
  await edit('course.block', { lesson, content: { kind: 'text', text: 'Hold crates when a reading is outside the approved range.' } })
  await edit('course.question', { prompt: 'What is the chilled-crate temperature limit?', choices: 'Below 5 C\nBelow 12 C', correct: '1' })
  await edit('course.question', { prompt: 'Where is the thermometer reading recorded?', choices: 'Dispatch log\nPersonal notes', correct: '1' })
  await edit('course.assessment', { passPercent: 100, maxAttempts: 3 })
  const submitted = await http.api('course.submit', { course: created.id, draftVersion: current.draftVersion })
  const reviewerHttp = nativeHttp({ ...context, cookie: state.reviewer.cookie })
  await reviewerHttp.form('/app/do/revision.decide', { revision: submitted.id, decision: 'publish', returnTo: `/app/courses/${created.id}` })
  const revision = await http.api(`revisions/${submitted.id}`)
  requireThat(revision.revision.state === 'published', 'Native human publication did not publish the revision')
  const nextSource = await http.api('source.version', {
    source: source.id, provenance: 'Sierra Lakes revised dispatch procedure, tighter chilled-crate limit',
    file: file('sierra-lakes-cold-chain-v2.txt', changedProcedure),
  })
  const detail = await http.api(`courses/${created.id}`)
  const notice = detail.notices.find(item => item.new_version_id === nextSource.id)
  requireThat(notice, 'Native source update did not create a course notice')
  const first = detail.draft.lessons[0]
  return {
    source: { id: source.id, versionId: source.versionId, nextVersionId: nextSource.id, filename: 'sierra-lakes-cold-chain.txt', text: procedure },
    course: {
      id: created.id, draftVersion: detail.draftVersion, draft: detail.draft,
      lesson: first.id, otherLesson: detail.draft.lessons[1].id, removableLesson: detail.draft.lessons[2].id,
      question: detail.draft.questions[0].id, removableQuestion: detail.draft.questions[1].id,
      block: first.blocks[0].id, otherBlock: first.blocks[1].id,
      fromBlock: `${created.id}:${first.id}:${first.blocks[0].id}`, revision: submitted.id,
    },
    revision: { id: submitted.id, course: created.id },
    impact: { id: notice.id, notice: notice.id, course: created.id, draftVersion: detail.draftVersion },
  }
}
