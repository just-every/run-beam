import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
      assert.equal(response.status, 404, `${path}: ${response.status}`)
      for (const secret of [...bindingNames, ...bindingValues]) assert.equal(body.includes(secret), false, `${path} exposed a binding`)
    }
  }

  assert.equal((await api('learner', 'language.change', { language: 'es-US' })).language, 'es-US')
  const changed = await h.submit('language.change', cookies.learner, { language: 'en-US' }, '/app/learning')
  assert.equal(changed.searchParams.get('error'), null)
}

// Run as a file, not `node --input-type=module -e`: Miniflare's synchronous
// D1 bridge starts a CommonJS eval worker that inherits the parent's execArgv.
// On Node 22, --input-type=module breaks that worker and leaves D1 waiting.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const started = performance.now()
  const { fixture } = await import('./regression-fixture.mjs')
  const f = await fixture()
  console.log(`FIXTURE_READY action dispatch (${Math.round(performance.now() - started)} ms)`)
  try {
    await actionDispatchCheck(f)
    console.log('PASS SECURITY action dispatch uses registered names only')
  } finally {
    await f.h.close()
  }
}
