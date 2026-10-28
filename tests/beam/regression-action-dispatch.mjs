import assert from 'node:assert/strict'

// Action dispatch accepts only explicitly registered actions at both human doors.
export async function actionDispatchCheck({ h, cookies, api }) {
  const inheritedNames = ['constructor', '__proto__', 'toString', 'hasOwnProperty']
  const bindingNames = [...Object.keys(h.vars), 'DB', 'FILES']
  const bindingValues = Object.values(h.vars).filter(value => typeof value === 'string' && value)

  for (const name of inheritedNames) {
    for (const path of [`/api/beam/${name}`, `/app/do/${name}`]) {
      const response = await h.raw(path, {
        cookie: cookies.learner,
        ...(path.startsWith('/api/') ? { body: {} } : { form: new URLSearchParams({ returnTo: '/app/learning' }) }),
      })
      const body = await response.text()
      assert.equal(response.status, 404, `${path}: unexpected status ${response.status}`)
      for (const secret of [...bindingNames, ...bindingValues]) assert.equal(body.includes(secret), false, `${path} exposed a binding`)
    }
  }

  // Proposal kinds use the same unknown-name boundary as action dispatch.
  const statuses = []
  for (const kind of ['unknown_kind', 'constructor', '__proto__']) {
    const response = await h.raw('/api/beam/agent.propose', { cookie: cookies.learner, body: { kind } })
    const body = await response.text()
    statuses.push(response.status)
    for (const secret of [...bindingNames, ...bindingValues]) assert.equal(body.includes(secret), false, 'proposal kind exposed a binding')
    // Compare a boolean so assertion failures cannot print the response body.
    if (response.status === 400) assert.equal(body === JSON.stringify({ error: 'invalid_kind' }), true, 'unexpected unknown-kind answer')
  }
  assert.deepEqual(statuses, [400, 400, 400], 'unknown, constructor and __proto__ proposal statuses')
  const proposed = await h.raw('/api/beam/agent.propose', {
    cookie: cookies.manager,
    body: { kind: 'process_change', title: 'Clarify shift handover', reasons: ['Make handovers consistent.'], payload: { summary: 'Clarify the handover', change: 'Record open work at the end of each shift.' } },
  })
  assert.equal(proposed.status, 200, 'registered proposal kind status')
  assert.equal(typeof (await proposed.json()).id === 'string', true, 'registered proposal was created')

  assert.equal((await api('learner', 'language.change', { language: 'es-US' })).language, 'es-US')
  const changed = await h.submit('language.change', cookies.learner, { language: 'en-US' }, '/app/learning')
  assert.equal(changed.searchParams.get('error'), null)
}
