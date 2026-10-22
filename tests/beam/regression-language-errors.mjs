import assert from 'node:assert/strict'
import { file } from './harness.mjs'

// One localization flow through real form doors: refusals explain the submitted field/action,
// and leave enrollment, quiz attempts and signature evidence unchanged.
export async function languageErrorCheck(f) {
  const { api, h, ids, cookies } = f
  assert.equal((await api('learner', 'language')).language, 'es-US')
  const course = await api('author', 'course.create', { title: 'synthetic-beam-1', reviewer: ids.reviewer })
  const lesson = await api('author', 'course.lesson', { course: course.id, draftVersion: course.draftVersion, title: 'synthetic-beam-2', body: 'synthetic-beam-3', sources: [] })
  const question = await api('author', 'course.question', { course: course.id, draftVersion: lesson.draftVersion, prompt: 'synthetic-beam-4', choices: 'synthetic-beam-5\nsynthetic-beam-6', correct: '1' })
  const assessment = await api('author', 'course.assessment', { course: course.id, draftVersion: question.draftVersion, passPercent: 100, maxAttempts: 2 })
  await f.publish((await api('author', 'course.submit', { course: course.id, draftVersion: assessment.draftVersion })).id)
  const assignment = await f.assign(course)
  await f.lessons(assignment)
  const quiz = await api('learner', `assignments/${assignment}`)
  const source = await api('author', 'source.create', { title: 'synthetic-beam-7', licence: 'owned', licenceEvidence: 'synthetic-beam-8', provenance: 'synthetic-beam-9', reviewer: ids.reviewer, file: file('synthetic-beam-10.txt', 'synthetic-beam-11') })
  const acknowledgment = (await api('owner', 'acknowledgment.request', { source: source.id, kind: 'signature', learners: [ids.learner] })).created[0]
  assert.equal((await h.raw(`/app/acknowledgments/${acknowledgment}/document`, { cookie: cookies.learner })).status, 200)
  const failures = [
    { action: 'quiz.submit', fields: { assignment, [`q_${quiz.quiz.questions[0].id}`]: '99' }, path: `/app/learn/${assignment}/quiz`, code: 'invalid_answer', explanation: /respuesta.*no es una opción válida/i },
    { action: 'catalog.withdraw', fields: { assignment }, path: '/app/catalog', code: 'required_work', explanation: /no puedes.*capacitación obligatoria/i },
    { action: 'acknowledgment.decide', fields: { acknowledgment, decision: 'sign', agree: 'yes', signature: 'synthetic-beam-12' }, path: `/app/acknowledgments/${acknowledgment}`, code: 'signature_must_match_name', explanation: /nombre completo.*Beam/i },
  ]
  const errorPages = []
  for (const failure of failures) {
    const destination = await h.submit(failure.action, cookies.learner, failure.fields, failure.path)
    assert.equal(destination.searchParams.get('error'), failure.code)
    errorPages.push([failure.action.split('.')[0], destination.pathname + destination.search])
    const response = await h.raw(destination.pathname + destination.search, { cookie: cookies.learner })
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /<html lang="es-US">/)
    const alert = html.match(/<p class="flash error" role="alert">([^<]*)<\/p>/)?.[1]
    assert.ok(alert, `${failure.action} explains its refusal`)
    assert.match(alert, failure.explanation)
    assert.ok(!alert.includes(failure.code), `${failure.action} shows a useful explanation instead of an internal code`)
  }
  if (process.env.BEAM_LANGUAGE_BROWSER === '1') {
    const { languageBrowserCheck } = await import('./regression-language-browser.mjs')
    await languageBrowserCheck(f, { errorPages })
  }
  const after = await api('learner', `assignments/${assignment}`)
  assert.equal(after.assignment.status, 'open')
  assert.equal(after.attempts.length, 0)
  assert.equal((await api('learner', `acknowledgments/${acknowledgment}`)).state, 'open')
}
