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
      assert.equal(response.status, 404, `${path}: ${response.status} ${body.slice(0, 300)}`)
      for (const secret of [...bindingNames, ...bindingValues]) assert.equal(body.includes(secret), false, `${path} exposed a binding`)
    }
  }

  assert.equal((await api('learner', 'language.change', { language: 'es-US' })).language, 'es-US')
  const changed = await h.submit('language.change', cookies.learner, { language: 'en-US' }, '/app/learning')
  assert.equal(changed.searchParams.get('error'), null)
}
