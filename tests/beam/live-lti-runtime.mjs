// Isolated synthetic people through Beam's real public doors, using the relay origin as installation issuer.
import assert from 'node:assert/strict'
import { emittedWorker } from '../runtime.mjs'
import { hostedRequest } from './live-lti-http.mjs'
export async function ltiFixture(origin) {
  const h = await emittedWorker({ bindings: { AUTH_ORIGIN: origin, BEAM_LTI_HOSTS: 'saltire.lti.app' } })
  const cookies = {}, ids = {}
  const raw = (path, options) => hostedRequest(h.origin, origin, path, options)
  const api = async (role, action, body, status = 200) => {
    const response = await raw('/api/beam/' + action, { cookie: cookies[role], body })
    assert.equal(response.status, status, `Beam ${action}: HTTP ${response.status}`)
    return response.json()
  }
  async function signin(role, invited = false) {
    if (!invited) assert.equal((await raw('/auth/magic-link', { body: { email: `${role}@example.test`, returnTo: '/app' } })).status, 202)
    const link = h.linkFor(`${role}@example.test`)
    assert.ok(link, 'Fixture sign-in reaches the captured network edge')
    const response = await raw('/auth/confirm', { body: { token: link.searchParams.get('token') } })
    assert.equal(response.status, 303)
    cookies[role] = response.headers.getSetCookie().map(x => x.split(';')[0]).join('; ')
    ids[role] = (await api(role, 'me')).id
  }
  try {
    const bootstrap = await raw('/auth/bootstrap', { body: { token: h.vars.SETUP_TOKEN, displayName: 'synthetic-beam-1' } })
    const code = bootstrap.status === 303 ? '' : (await bootstrap.clone().json()).error
    assert.equal(bootstrap.status, 303, `Beam bootstrap: ${/^[a-z_]+$/.test(code) ? code : 'refused'}`)
    await signin('owner')
    await raw('/setup', { cookie: cookies.owner, form: new URLSearchParams({ confirm: 'yes' }) })
    await api('owner', 'business.configure', { name: 'synthetic-beam-1', timezone: 'UTC' })
    for (const [role, roles] of Object.entries({ author: ['author'], reviewer: ['reviewer', 'author'], learner: ['learner'] })) {
      await api('owner', 'person.invite', { name: `synthetic-beam-${role}`, email: `${role}@example.test`, roles })
      await signin(role, true)
    }
    return { raw, api, ids, cookies, close: h.close }
  } catch (error) { await h.close(); throw error }
}
