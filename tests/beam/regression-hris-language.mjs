// Real Gusto wire schemas, faked only at its HTTPS network boundary.
// No provider writes, person creation or enrollment is part of this language-only connector.
import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'
export async function hrisLanguageCheck() {
  const edge = { calls: [], refused: false, company: 'synthetic-beam-2', employee: 'synthetic-beam-3', language: 'es-US', missing: false, fieldsGate: null }
  const f = await fixture({ bindings: { GUSTO_ACCESS_TOKEN: 'synthetic-beam-1' }, outboundService: async request => {
    const url = new URL(request.url)
    if (url.origin !== 'https://api.gusto-demo.com') return null
    edge.calls.push({ method: request.method, pathname: url.pathname })
    assert.equal(request.method, 'GET', 'Language ingestion never writes to Gusto')
    if (edge.refused) return Response.json({ error: 'synthetic-beam-50' }, { status: 403 })
    if (url.pathname === '/v1/employees/synthetic-beam-3') return Response.json({ uuid: edge.employee, company_uuid: edge.company, first_name: 'synthetic-beam-50', last_name: 'synthetic-beam-51', email: 'synthetic-beam-52@example.test' })
    assert.equal(url.pathname, '/v1/employees/synthetic-beam-3/custom_fields')
    if (edge.fieldsGate) await edge.fieldsGate()
    return Response.json({ custom_fields: edge.missing ? [] : [{ id: 'synthetic-beam-4', company_custom_field_id: 'synthetic-beam-5', name: 'Preferred language', type: 'text', value: edge.language, description: null, selection_options: null }] })
  } })
  const { api, ids } = f
  try {
    await api('owner', 'person.directory', { member: ids.learner, employeeId: 'synthetic-beam-6' })
    const course = await f.course('Safe tool handling'), assignment = await f.assign(course)
    await f.lessons(assignment)
    const original = (await api('learner', 'records/me')).completions
    const config = { member: ids.learner, employeeId: 'synthetic-beam-6', employeeUuid: 'synthetic-beam-3', companyUuid: 'synthetic-beam-2', fieldId: 'synthetic-beam-5', environment: 'demo', version: 0, consent: true }
    await api('manager', 'gusto.language.configure', config, 403)
    await api('owner', 'gusto.language.configure', { ...config, consent: false }, 409)
    await api('owner', 'gusto.language.configure', { ...config, employeeId: 'synthetic-beam-8' }, 409)
    assert.equal(edge.calls.length, 0, 'Mapping and consent never pull implicitly')
    const mapping = await api('owner', 'gusto.language.configure', config)
    const screen = async (name, heading = 'learner · language mapping') => {
      if (process.env.BEAM_LANGUAGE_BROWSER !== '1') return
      const { courseLocaleBrowser } = await import('./regression-course-locale-browser.mjs')
      await courseLocaleBrowser(f, [[name, 'owner', '/app/people', heading]])
    }
    await screen('hris-consent', 'Gusto language preference')
    const pull = () => api('owner', 'gusto.language.pull', { mapping: mapping.id, version: mapping.version })
    const stored = async () => (await api('owner', `directory/${ids.learner}`)).person.language
    assert.equal((await pull()).outcome, 'updated')
    assert.equal((await api('learner', 'language')).language, 'es-US')
    await screen('hris-updated')
    assert.deepEqual((await api('learner', 'records/me')).completions, original, 'HRIS preference preserves prior learning and identity')
    edge.language = 'fr-FR'
    assert.equal((await pull()).outcome, 'updated')
    assert.equal(await stored(), 'fr-FR', 'Unsupported valid preference remains in the directory')
    assert.equal((await api('learner', 'language')).language, 'en-US', 'Unsupported preference follows normal default resolution')
    edge.refused = true
    assert.equal((await pull()).outcome, 'gusto_provider_denied')
    let view = await api('owner', 'gusto-language')
    assert.equal(view.mappings[0].last_outcome, 'gusto_provider_denied')
    assert.ok(view.mappings[0].last_synced_at && view.mappings[0].last_failure)
    await screen('hris-refused')
    const deniedCount = edge.calls.length
    await f.h.scheduled()
    assert.equal(edge.calls.length, deniedCount, 'Scheduled work never retries a manual HRIS read')
    edge.refused = false
    assert.equal((await pull()).outcome, 'updated', 'An explicit owner pull recovers after provider access returns')
    for (const name of ['company', 'employee']) {
      const prior = edge[name]; edge[name] = 'synthetic-beam-9'
      assert.equal((await pull()).outcome, 'gusto_identity_mismatch')
      assert.equal(await stored(), 'fr-FR')
      edge[name] = prior
    }
    edge.missing = true
    assert.equal((await pull()).outcome, 'gusto_field_missing')
    edge.missing = false; edge.language = 'not a language'
    assert.equal((await pull()).outcome, 'gusto_language_invalid')
    await api('owner', 'person.directory', { member: ids.learner, employeeId: 'synthetic-beam-8' })
    const beforeChanged = edge.calls.length
    assert.equal((await pull()).outcome, 'gusto_directory_changed')
    assert.equal(edge.calls.length, beforeChanged, 'Changed local employee identity blocks remote reads')
    await api('owner', 'person.directory', { member: ids.learner, employeeId: 'synthetic-beam-6' })
    // Consent can be revoked while a real-shaped provider response is in flight.
    let entered, release
    const atField = new Promise(resolve => { entered = resolve }), gate = new Promise(resolve => { release = resolve })
    edge.language = 'es-US'; edge.fieldsGate = async () => { entered(); await gate }
    const pending = pull()
    let deadline
    try { await Promise.race([atField, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Provider field read did not start')), 10_000) })]); await api('owner', 'gusto.language.revoke', { mapping: mapping.id, version: mapping.version }) } finally { clearTimeout(deadline); release() }
    assert.equal((await pending).outcome, 'gusto_consent_changed')
    assert.equal(await stored(), 'fr-FR', 'Revoked in-flight consent prevents the directory write')
    await screen('hris-revoked')
    const revokedCount = edge.calls.length
    await api('owner', 'gusto.language.pull', { mapping: mapping.id, version: mapping.version + 1 }, 409)
    assert.equal(edge.calls.length, revokedCount)
    const audit = JSON.stringify(await api('owner', 'audit?q=gusto.language'))
    for (const unrelated of ['synthetic-beam-50', 'synthetic-beam-51', 'synthetic-beam-52', 'fr-FR', 'es-US']) assert.ok(!audit.includes(unrelated), 'Audit records changed field names, not provider bodies or preference values')
    assert.ok(audit.includes('language') && audit.includes('gusto.language.failure'))
  } finally { await f.h.close() }
}
