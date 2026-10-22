// AUTHOR-008/LEARN-017 foundation: actual externally prepared Spanish, never simulated AI output.
import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'

export async function courseLocaleCheck() {
  const f = await fixture(), { api, h, ids, cookies } = f
  const localeView = course => api('author', `course-locales/${course}`)
  try {
    const source = await api('author', 'source.create', { title: 'Safe tool procedure', licence: 'owned', licenceEvidence: 'Synthetic authored procedure', provenance: 'Synthetic fixture', reviewer: ids.reviewer, file: file('synthetic-beam-1.txt', 'Use clean tools before work.') })
    const course = await api('author', 'course.create', { title: 'Clean tool safety', reviewer: ids.reviewer })
    const lesson = await api('author', 'course.lesson', { course: course.id, draftVersion: course.draftVersion, title: 'Clean tools', body: 'Use clean tools before work.', sources: [source.versionId] })
    const choice = await api('author', 'course.question', { course: course.id, draftVersion: lesson.draftVersion, prompt: 'Choose the safe tools.', choices: 'Clean\nDirty', correct: '1' })
    const blank = await api('author', 'course.question', { course: course.id, draftVersion: choice.draftVersion, kind: 'blank', prompt: 'Use ___ tools.', answers: 'clean', ignoreCase: true })
    const assessment = await api('author', 'course.assessment', { course: course.id, draftVersion: blank.draftVersion, passPercent: 100, maxAttempts: 3 })
    const baseRevision = (await api('author', 'course.submit', { course: course.id, draftVersion: assessment.draftVersion })).id
    await f.publish(baseRevision)
    const before = await localeView(course.id)
    assert.equal(before.baseRevision, baseRevision)
    const glossary = await api('author', 'glossary.save', { course: course.id, locale: 'es-US', terms: [{ source: 'clean tools', target: 'herramientas limpias' }] })
    await api('author', 'glossary.approve', { glossary: glossary.id, confirm: true }, 403)
    const translation = structuredClone(before.template)
    Object.assign(translation, { title: 'Herramientas seguras', summary: 'Procedimiento de seguridad.' })
    Object.assign(translation.lessons[0], { title: 'Herramientas limpias', body: 'Usa herramientas sucias antes de trabajar.' })
    Object.assign(translation.questions[0], { prompt: 'Elige las herramientas seguras.', choices: ['Limpias', 'Sucias'] })
    Object.assign(translation.questions[1], { prompt: 'Usa herramientas ___.', blanks: [['limpias']] })
    const prepare = draft => ({ course: course.id, baseRevision, locale: 'es-US', glossary: glossary.id, draft })
    await api('author', 'locale.prepare', prepare(translation), 409)
    await api('owner', 'glossary.approve', { glossary: glossary.id, confirm: true })
    for (const corrupt of [draft => { draft.questions[0].correct = [1] }, draft => { draft.lessons[0].sources = [] }, draft => { draft.passPercent = 1 }]) {
      const changed = structuredClone(translation); corrupt(changed)
      assert.equal((await api('author', 'locale.prepare', prepare(changed), 409)).error, 'locale_structure_changed')
    }
    const prepared = await api('author', 'locale.prepare', prepare(translation))
    await api('author', 'locale.submit', { translation: prepared.id, version: 1 })
    await api('author', 'locale.approve', { translation: prepared.id, version: 1, glossaryReviewed: true, correctnessReviewed: true }, 403)
    const unreviewed = await h.submit('locale.approve', cookies.owner, { translation: prepared.id, version: 1 }, `/app/courses/${course.id}`)
    assert.equal(unreviewed.searchParams.get('error'), 'language_review_required')
    // Review catches the deliberate mistranslation; correcting it invalidates the submitted draft.
    translation.lessons[0].body = 'Usa herramientas limpias antes de trabajar.'
    const edited = process.env.BEAM_LANGUAGE_BROWSER === '1'
      ? await (await import('./regression-course-locale-browser.mjs')).correctLocaleText(f, course.id, prepared.id, translation.lessons[0].body)
      : await api('author', 'locale.edit', { translation: prepared.id, version: 1, draft: translation })
    assert.equal(edited.version, 2)
    await api('author', 'locale.submit', { translation: prepared.id, version: 2 })
    if (process.env.BEAM_LANGUAGE_BROWSER === '1') {
      const { courseLocaleBrowser } = await import('./regression-course-locale-browser.mjs')
      await courseLocaleBrowser(f, [['review', 'owner', `/app/courses/${course.id}`, 'Course languages'], ['correction', 'owner', `/app/courses/${course.id}`, 'es-US · in review'], ['approval', 'owner', `/app/courses/${course.id}`, 'Approve language revision']])
    }
    const approve = await h.submit('locale.approve', cookies.owner, { translation: prepared.id, version: 2, glossaryReviewed: 'yes', correctnessReviewed: 'yes' }, `/app/courses/${course.id}`)
    assert.equal(approve.searchParams.get('error'), null)
    const approved = (await localeView(course.id)).translations.find(row => row.id === prepared.id)
    assert.equal(approved.state, 'approved')
    const localized = approved.revision_id
    assert.notEqual(localized, baseRevision)
    assert.equal((await api('author', `courses/${course.id}`)).publishedRevision, baseRevision, 'Spanish approval leaves the English published head untouched')
    await api('author', 'locale.edit', { translation: prepared.id, version: 2, draft: translation }, 409)
    await api('owner', 'person.directory', { member: ids.learner, language: 'es-US' })
    const assignment = await f.assign(course)
    let view = await api('learner', `assignments/${assignment}`)
    assert.equal(view.assignment.revision, localized)
    assert.equal(view.lessons[0].body, translation.lessons[0].body)
    const html = await (await h.raw(`/app/learn/${assignment}/lessons/${view.lessons[0].id}`, { cookie: cookies.learner })).text()
    assert.ok(html.includes('Usa herramientas limpias antes de trabajar.'))
    assert.ok(!html.includes('No hay una versión revisada en español'))
    if (process.env.BEAM_LANGUAGE_BROWSER === '1') {
      const { courseLocaleBrowser } = await import('./regression-course-locale-browser.mjs')
      await courseLocaleBrowser(f, [['course', 'learner', `/app/learn/${assignment}`, 'Herramientas seguras'], ['lesson', 'learner', `/app/learn/${assignment}/lessons/${view.lessons[0].id}`, 'Herramientas limpias'], ['quiz', 'learner', `/app/learn/${assignment}/quiz`, 'Cuestionario']])
    }
    await f.lessons(assignment)
    const answers = {}
    for (const question of view.quiz.questions) {
      if (question.kind === 'blank') answers[`q_${question.id}_0`] = 'limpias'
      else answers[`q_${question.id}`] = ['0']
    }
    await api('learner', 'quiz.submit', { assignment, ...answers })
    view = await api('learner', `assignments/${assignment}`)
    assert.equal(view.completion.revision, localized)
    const certificate = await api('learner', `certificates/${view.completion.certificate}`)
    await api('author', 'source.version', { source: source.id, provenance: 'Synthetic source update', file: file('synthetic-beam-3.txt', 'Use clean inspected tools before work.') })
    const maintenance = (await localeView(course.id)).maintenance
    assert.ok(maintenance.some(row => row.locale_id === prepared.id && row.cause === 'source_changed'))
    assert.deepEqual(await api('learner', `certificates/${view.completion.certificate}`), certificate, 'Source maintenance never rewrites the localized certificate')
    assert.equal((await api('learner', `assignments/${assignment}`)).completion.revision, localized)
    const fallback = await f.course('English-only safety briefing'), fallbackAssignment = await f.assign(fallback)
    assert.equal((await api('learner', `assignments/${fallbackAssignment}`)).assignment.revision, fallback.revision)
    const fallbackHtml = await (await h.raw(`/app/learn/${fallbackAssignment}`, { cookie: cookies.learner })).text()
    assert.ok(fallbackHtml.includes('No hay una versión revisada en español'))
    if (process.env.BEAM_LANGUAGE_BROWSER === '1') {
      const { courseLocaleBrowser } = await import('./regression-course-locale-browser.mjs')
      await courseLocaleBrowser(f, [['maintenance', 'owner', `/app/courses/${course.id}`, 'Language maintenance'], ['completed', 'learner', `/app/learn/${assignment}`, 'Herramientas seguras'], ['certificate', 'learner', `/app/certificates/${view.completion.certificate}`, 'Herramientas seguras'], ['fallback', 'learner', `/app/learn/${fallbackAssignment}`, 'English-only safety briefing']])
    }
  } finally { await h.close() }
}
