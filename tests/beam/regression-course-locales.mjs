// Paid-edge course translation, timed captions, human correction and immutable learner evidence.
import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'
import { modelEdge } from './model-edge.mjs'
import { syntheticVideo } from './fixtures.mjs'
import { file } from './harness.mjs'

export async function courseLocaleCheck({ live = false } = {}) {
  const dictionary = { 'Clean tool safety': 'Herramientas seguras', 'Clean tools': 'Herramientas limpias', 'Use clean tools before work.': 'Usa herramientas limpias antes de trabajar.', 'Choose the safe tools.': 'Elige las herramientas seguras.', 'Clean': 'Limpias', 'Dirty': 'Sucias', 'Use ___ tools.': 'Usa herramientas ___.', 'clean': 'limpias', 'Safety video': 'Vídeo de seguridad', 'Tool checklist': 'Lista de herramientas', 'Condition': 'Estado', 'Clean tools only': 'Solo herramientas limpias', 'Inspect clean tools.': 'Inspecciona herramientas limpias.' }
  const edge = modelEdge(data => ({ translations: data.fields.map(field => ({ key: field.key, text: dictionary[field.value] ?? field.value })) }), { live })
  const f = await fixture({ businessName: 'Sierra Lakes Produce', ownerName: 'Morgan Hayes', names: { author: 'Jordan Lee', reviewer: 'Sam Taylor', learner: 'Riley Morgan', manager: 'Nina Brooks' }, outboundService: edge.outboundService }), { api, h, ids, cookies } = f
  const localeView = course => api('author', `course-locales/${course}`)
  try {
    const source = await api('author', 'source.create', { title: 'Safe tool procedure', licence: 'owned', licenceEvidence: 'Synthetic authored procedure', provenance: 'Synthetic fixture', reviewer: ids.reviewer, file: file('synthetic-beam-1.txt', 'Use clean tools before work.') })
    const course = await api('author', 'course.create', { title: 'Clean tool safety', reviewer: ids.reviewer })
    const lesson = await api('author', 'course.lesson', { course: course.id, draftVersion: course.draftVersion, title: 'Clean tools', body: 'Use clean tools before work.', sources: [source.versionId] })
    const video = await api('author', 'source.create', { title: 'Clean tool demonstration', licence: 'owned', licenceEvidence: 'Synthetic original', provenance: 'Synthetic authored video', reviewer: ids.reviewer, file: file('synthetic-beam-4.webm', syntheticVideo) })
    const vtt = 'WEBVTT\n\nopening\n00:00.000 --> 00:00.900 align:start\nInspect clean tools.\n'
    const captions = await api('author', 'source.create', { title: 'Reviewed clean tool captions', licence: 'owned', licenceEvidence: 'Synthetic original', provenance: 'Reviewed English WebVTT', reviewer: ids.reviewer, file: file('synthetic-beam-5.vtt', vtt) })
    const block = await api('author', 'course.block', { course: course.id, draftVersion: lesson.draftVersion, lesson: lesson.draft.lessons[0].id, content: { kind: 'video', source: video.versionId, text: 'Safety video', captions: { source: captions.versionId, language: 'en', label: 'English' } } })
    const table = await api('author', 'course.block', { course: course.id, draftVersion: block.draftVersion, lesson: lesson.draft.lessons[0].id, content: { kind: 'table', text: 'Tool checklist', table: [[{ text: 'Condition', header: true, colSpan: 1, rowSpan: 1 }], [{ text: 'Clean tools only', header: false, colSpan: 1, rowSpan: 1 }]] } })
    const choice = await api('author', 'course.question', { course: course.id, draftVersion: table.draftVersion, prompt: 'Choose the safe tools.', choices: 'Clean\nDirty', correct: '1' })
    const blank = await api('author', 'course.question', { course: course.id, draftVersion: choice.draftVersion, kind: 'blank', prompt: 'Use ___ tools.', answers: 'clean', ignoreCase: true })
    const assessment = await api('author', 'course.assessment', { course: course.id, draftVersion: blank.draftVersion, passPercent: 100, maxAttempts: 3 })
    const baseRevision = (await api('author', 'course.submit', { course: course.id, draftVersion: assessment.draftVersion })).id
    await f.publish(baseRevision)
    const before = await localeView(course.id)
    console.log('Prepared published English course and reviewed timed captions')
    assert.equal(before.baseRevision, baseRevision)
    const glossary = await api('author', 'glossary.save', { course: course.id, locale: 'es-US', terms: [{ source: 'clean tools', target: 'herramientas limpias' }] })
    await api('author', 'glossary.approve', { glossary: glossary.id, confirm: true }, 403)
    const translation = structuredClone(before.template)
    Object.assign(translation, { title: 'Herramientas seguras', summary: 'Procedimiento de seguridad.' })
    Object.assign(translation.lessons[0], { title: 'Herramientas limpias', body: 'Usa herramientas sucias antes de trabajar.' })
    translation.lessons[0].blocks[0].text = 'Vídeo de seguridad'
    translation.lessons[0].blocks[1].text = 'Lista de herramientas'
    translation.lessons[0].blocks[1].table[0][0].text = 'Estado'
    translation.lessons[0].blocks[1].table[1][0].text = 'Solo herramientas limpias'
    Object.assign(translation.questions[0], { prompt: 'Elige las herramientas seguras.', choices: ['Limpias', 'Sucias'] })
    Object.assign(translation.questions[1], { prompt: 'Usa herramientas ___.', blanks: [['limpias']] })
    const prepare = draft => ({ course: course.id, baseRevision, locale: 'es-US', glossary: glossary.id, draft, subtitles: { locale_subtitle_0_0: 'Inspecciona herramientas limpias.' } })
    await api('author', 'locale.prepare', prepare(translation), 409)
    await api('owner', 'glossary.approve', { glossary: glossary.id, confirm: true })
    for (const corrupt of [draft => { draft.questions[0].correct = [1] }, draft => { draft.lessons[0].sources = [] }, draft => { draft.passPercent = 1 }]) {
      const changed = structuredClone(translation); corrupt(changed)
      assert.equal((await api('author', 'locale.prepare', prepare(changed), 409)).error, 'locale_structure_changed')
    }
    await api('author', 'model.configure', { operation: 'enable', apiKey: 'synthetic-beam-1', maxCostCents: 1000, consent: true }, 403)
    const key = live ? process.env.BEAM_MODEL_KEY : 'synthetic-beam-1'
    assert.ok(key, 'Held preparation key injected through the approved env door')
    await api('owner', 'model.configure', { operation: 'enable', apiKey: key, maxCostCents: 1000, consent: true })
    const parameters = new URLSearchParams({ baseRevision, locale: 'es-US', glossary: glossary.id })
    const previewPath = `course-locales/${course.id}/model-preview?${parameters}`
    const preview = await api('owner', previewPath)
    assert.equal(edge.calls.length, 0, 'Opening preview never spends')
    const request = { ...preview, course: course.id, baseRevision, locale: 'es-US', glossary: glossary.id }
    await api('owner', 'locale.model.run', { ...request, consent: false }, 409)
    await api('owner', 'locale.model.run', { ...request, estimateCents: 0, consent: true }, 409)
    await api('author', 'locale.model.run', { ...request, consent: true }, 403)
    if (process.env.BEAM_LANGUAGE_BROWSER === '1') {
      const { courseLocaleBrowser } = await import('./regression-course-locale-browser.mjs')
      await courseLocaleBrowser(f, [['account', 'owner', '/app/model-account', 'AI preparation account'], ['costs', 'owner', '/app/business', 'Provider costs (USD)'], ['request', 'owner', `/app/courses/${course.id}/translate?glossary=${glossary.id}`, 'Approve one translation request']])
    }
    let generated
    if (process.env.BEAM_LANGUAGE_BROWSER === '1') {
      await (await import('./regression-course-locale-browser.mjs')).approveModelInBrowser(f, `/app/courses/${course.id}/translate?glossary=${glossary.id}`, 'locale.model.run')
      generated = (await localeView(course.id)).translations[0]
    } else generated = await api('owner', 'locale.model.run', { ...request, consent: true })
    assert.equal(edge.calls.length, 1)
    if (process.env.BEAM_LANGUAGE_BROWSER !== '1') await api('owner', 'locale.model.run', { ...request, consent: true }, 409)
    assert.equal(edge.calls.length, 1, 'Consumed approval never repeats paid work')
    assert.equal((await api('author', `courses/${course.id}`)).publishedRevision, baseRevision)
    const generatedView = (await localeView(course.id)).translations.find(row => row.id === generated.id)
    assert.ok(generatedView.draft.lessons[0].body.toLowerCase().includes('herramientas limpias'), 'The generated lesson uses the approved glossary term')
    assert.notEqual(generatedView.draft.lessons[0].body, before.template.lessons[0].body, 'Real translated text enters the editable draft')
    assert.notEqual(generatedView.draft.lessons[0].blocks[1].table[0][0].text, before.template.lessons[0].blocks[1].table[0][0].text, 'Table text participates in model translation')
    assert.equal(generatedView.draft.lessons[0].blocks[1].table[0][0].header, true)
    const correctSubtitle = JSON.parse(generatedView.subtitles_json)
    assert.match(correctSubtitle.locale_subtitle_0_0, /limpia/i)
    const bad = await api('author', 'locale.edit', { translation: generated.id, version: 1, draft: generatedView.draft, subtitles: { locale_subtitle_0_0: '00:01.000 --> 00:02.000\nInjected cue' } }, 400)
    assert.ok(bad.error)
    const prepared = await api('author', 'locale.edit', { translation: generated.id, version: 1, draft: translation, subtitles: { locale_subtitle_0_0: 'Inspecciona herramientas sucias.' } })
    await api('author', 'locale.submit', { translation: prepared.id, version: 2 })
    await api('author', 'locale.approve', { translation: prepared.id, version: 2, glossaryReviewed: true, correctnessReviewed: true }, 403)
    const unreviewed = await h.submit('locale.approve', cookies.owner, { translation: prepared.id, version: 2 }, `/app/courses/${course.id}`)
    assert.equal(unreviewed.searchParams.get('error'), 'language_review_required')
    // Review catches the deliberate mistranslation; correcting it invalidates the submitted draft.
    translation.lessons[0].body = 'Usa herramientas limpias antes de trabajar.'
    const edited = process.env.BEAM_LANGUAGE_BROWSER === '1'
      ? await (await import('./regression-course-locale-browser.mjs')).correctLocaleText(f, course.id, prepared.id, translation.lessons[0].body)
      : await api('author', 'locale.edit', { translation: prepared.id, version: 2, draft: translation, subtitles: { locale_subtitle_0_0: 'Inspecciona herramientas limpias.' } })
    assert.equal(edited.version, 3)
    await api('author', 'locale.submit', { translation: prepared.id, version: 3 })
    if (process.env.BEAM_LANGUAGE_BROWSER === '1') {
      const { courseLocaleBrowser } = await import('./regression-course-locale-browser.mjs')
      await courseLocaleBrowser(f, [['review', 'owner', `/app/courses/${course.id}`, 'Course languages'], ['correction', 'owner', `/app/courses/${course.id}`, 'es-US · in review'], ['approval', 'owner', `/app/courses/${course.id}`, 'Approve language revision']])
    }
    const approve = await h.submit('locale.approve', cookies.owner, { translation: prepared.id, version: 3, glossaryReviewed: 'yes', correctnessReviewed: 'yes' }, `/app/courses/${course.id}`)
    assert.equal(approve.searchParams.get('error'), null)
    const approved = (await localeView(course.id)).translations.find(row => row.id === prepared.id)
    assert.equal(approved.state, 'approved')
    const localized = approved.revision_id
    assert.notEqual(localized, baseRevision)
    assert.equal((await api('author', `courses/${course.id}`)).publishedRevision, baseRevision, 'Spanish approval leaves the English published head untouched')
    await api('author', 'locale.edit', { translation: prepared.id, version: 3, draft: translation }, 409)
    await api('owner', 'person.directory', { member: ids.learner, language: 'es-US' })
    const assignment = await f.assign(course)
    let view = await api('learner', `assignments/${assignment}`)
    assert.equal(view.assignment.revision, localized)
    assert.equal(view.lessons[0].body, translation.lessons[0].body)
    const localizedCaption = view.lessons[0].blocks.find(block => block.kind === 'video').captions
    assert.equal(localizedCaption.language, 'es-US')
    assert.notEqual(localizedCaption.source, captions.versionId)
    const translatedVtt = await (await h.raw(`/app/files/caption/${localizedCaption.source}`, { cookie: cookies.learner })).text()
    assert.match(translatedVtt, /opening\n00:00.000 --> 00:00.900 align:start/)
    assert.match(translatedVtt, /herramientas limpias/)
    assert.equal(await (await h.raw(`/api/beam/source-files/${captions.versionId}`, { cookie: cookies.author })).text(), vtt)
    const paid = await api('owner', 'model-account')
    assert.equal(paid.runs[0].state, 'completed')
    assert.ok(paid.runs[0].provider_response_id && paid.runs[0].usage)
    console.log('Translation paid receipt', JSON.stringify({ model: paid.runs[0].model, providerResponseId: paid.runs[0].provider_response_id, usage: paid.runs[0].usage, calls: edge.calls.length }))
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
