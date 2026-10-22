// Real anonymous saLTIre HTTP UI driver. Never persist session cookies, keys or JWTs.
import assert from 'node:assert/strict'
import { createPublicKey } from 'node:crypto'
export const toolOrigin = 'https://saltire.lti.app'
export const decode = value => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[a-f0-9]+);/gi, match => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[match] ?? String.fromCodePoint(match.startsWith('&#x') ? parseInt(match.slice(3), 16) : parseInt(match.slice(2), 10))))
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1], decode(m[2] ?? m[3])]))
export function fields(html) {
  const result = new URLSearchParams()
  for (const m of html.matchAll(/<input\b[^>]*>|<textarea\b[^>]*>[\s\S]*?<\/textarea>|<select\b[^>]*>[\s\S]*?<\/select>/gi)) {
    const tag = m[0], a = attrs(tag.slice(0, tag.indexOf('>') + 1))
    if (!a.name || /\sdisabled(?:\s|>|=)/i.test(tag.slice(0, tag.indexOf('>') + 1))) continue
    if (['button', 'submit', 'file'].includes(a.type)) continue
    if (['checkbox', 'radio'].includes(a.type) && !/\schecked(?:\s|>|=)/i.test(tag)) continue
    let value = a.value ?? ''
    if (/^<textarea/i.test(tag)) value = decode(tag.slice(tag.indexOf('>') + 1, tag.lastIndexOf('</')))
    if (/^<select/i.test(tag)) {
      const options = [...tag.matchAll(/<option\b[^>]*>[\s\S]*?<\/option>/gi)].map(m => m[0])
      const selected = options.find(o => /\sselected(?:\s|>|=)/i.test(o)) ?? options[0]
      value = selected ? attrs(selected).value ?? '' : ''
    }
    result.append(a.name, value)
  }
  return result
}
export function form(html, id) {
  const all = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)]
  const match = all.find(m => !id || attrs(m[0].slice(0, m[0].indexOf('>') + 1)).id === id)
  assert.ok(match, `Expected saLTIre form ${id ?? 'response'}`)
  const a = attrs(match[0].slice(0, match[0].indexOf('>') + 1))
  return { action: a.action, method: a.method?.toUpperCase() ?? 'GET', fields: fields(match[0]) }
}
export async function saltire() {
  const cookies = new Map()
  async function request(url, body) {
    const target = new URL(url, toolOrigin)
    assert.equal(target.origin, toolOrigin, 'Never send tool session credentials to another host')
    const response = await fetch(target, { method: body ? 'POST' : 'GET', headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body, redirect: 'manual', signal: AbortSignal.timeout(35_000) })
    for (const row of response.headers.getSetCookie()) { const pair = row.split(';')[0], p = pair.indexOf('='); cookies.set(pair.slice(0, p), pair.slice(p + 1)) }
    const html = await response.text()
    assert.ok(response.status < 400, `saLTIre HTTP ${response.status}`)
    return { status: response.status, location: response.headers.get('location'), html }
  }
  let current = await request('/tool')
  const generated = JSON.parse((await request('/generatekey.php', new URLSearchParams({ signaturemethod: 'RS256' }))).html)
  assert.ok(generated.privateKey && generated.kid)
  const jwk = { ...createPublicKey(generated.publicKey).export({ format: 'jwk' }), kid: generated.kid, alg: 'RS256', use: 'sig' }
  let settings
  const save = async overrides => {
    settings = fields(current.html)
    for (const [key, value] of Object.entries(overrides)) settings.set(key, value)
    current = await request('/tool', settings)
    if (current.location) current = await request(current.location)
    return current
  }
  function standard(token) {
    return new URLSearchParams({ platformid: settings.get('t_platformid'), clientid: settings.get('t_clientid'), deploymentid: settings.get('t_deploymentid'), signaturemethod: 'RS256', encryptionmethod: '', key: '', secret: '', lenientmode: 'false', ...(token ? { token, tokenurl: settings.get('t_accesstokenurl') } : { kid: generated.kid, rsakey: generated.privateKey, tckey: settings.get('t_tckey') ?? '' }) })
  }
  return {
    jwk,
    async configure(origin, clientId, deployment) {
      await save({ t_signaturemethod: 'RS256', t_kid: generated.kid, t_privatekey: generated.privateKey, t_platformid: origin, t_clientid: clientId, t_deploymentid: deployment, t_authorizationid: `${origin}/api/beam/lti/token`, t_authrequest: `${origin}/api/beam/lti/authorize`, t_accesstokenurl: `${origin}/api/beam/lti/token`, t_accesstokenurl2: `${origin}/api/beam/lti/token`, t_jwks: `${origin}/api/beam/lti/jwks`, disablecookiecheck: 'on' })
      const stored = fields(current.html)
      assert.equal(stored.get('t_platformid'), origin, 'Anonymous tool retains the actual Beam issuer')
      assert.equal(stored.get('t_clientid'), clientId, 'Anonymous tool retains the registered client')
    },
    async authorize(prepared, beamRequest, cookie) {
      let login = await request(prepared.loginUrl)
      let target, query
      if (login.location) target = new URL(login.location, toolOrigin)
      else { const f = form(login.html); target = new URL(f.action, toolOrigin); query = f.fields }
      assert.ok(target.pathname.endsWith('/api/beam/lti/authorize'), 'Tool returns actual OIDC authorization request')
      if (query) target.search = query.toString()
      const handoff = await beamRequest(target.pathname + target.search, { cookie })
      assert.equal(handoff.status, 200, 'Beam consent handoff')
      const f = form(await handoff.text())
      assert.equal(new URL(f.action).origin, toolOrigin)
      const claims = JSON.parse(Buffer.from(f.fields.get('id_token').split('.')[1], 'base64url'))
      current = await request(f.action, f.fields)
      if (current.location) current = await request(current.location)
      return claims
    },
    async deepLink(beamRequest) {
      const items = { bespoke: { checked: true, target: ['window'], type: 'ltiResourceLink', title: 'synthetic-beam-1', text: 'Synthetic external exercise', url: toolOrigin + '/tool', mediatype: '', custom: '' }, target: ['window'], message: { msg: '', log: '', errormsg: '', errorlog: '' } }
      await save({ t_contentitems: JSON.stringify(items) })
      const f = form(current.html, 'id_contentitems')
      for (const [name, value] of Object.entries({ platformid: settings.get('t_platformid'), clientid: settings.get('t_clientid'), deploymentid: settings.get('t_deploymentid'), signaturemethod: 'RS256', kid: generated.kid, privatekey: generated.privateKey, jku: '', tckey: settings.get('t_tckey') ?? '' })) f.fields.set(name, value)
      const action = current.html.match(/doSubmitContent\(['"]([^'"]+)['"]\)/)?.[1]
      assert.ok(action, 'saLTIre exposes a signed deep-link return action')
      const actionTag = current.html.match(/<input\b[^>]*id=["']id_contentaction["'][^>]*>/)?.[0]
      f.fields.set(actionTag ? attrs(actionTag).name : 'action', action)
      const signed = await request(f.action, f.fields)
      const callback = form(signed.html)
      assert.ok(callback.fields.has('JWT'), 'Independent tool produced signed deep-link JWT')
      const response = await beamRequest(new URL(callback.action).pathname, { form: callback.fields })
      assert.equal(response.status, 200, 'Actual tool deep-link accepted by Beam')
      return { result: await response.json(), replay: () => beamRequest(new URL(callback.action).pathname, { form: callback.fields }) }
    },
    async token() {
      const body = standard(); body.set('url', settings.get('t_accesstokenurl')); body.set('authorizationid', settings.get('t_authorizationid')); body.append('scopes[]', 'https://purl.imsglobal.org/spec/lti-ags/scope/score')
      const data = JSON.parse((await request('/tp-accesstoken.php', body)).html)
      assert.ok(data.http?.ok, `saLTIre AGS token request failed (HTTP ${data.http?.status ?? 'unknown'})`)
      const result = typeof data.http.response === 'string' ? JSON.parse(data.http.response) : data.http.response
      assert.ok(result.access_token)
      return result.access_token
    },
    async score(token, lineitem, user, score) {
      const body = standard(token)
      for (const [key, value] of Object.entries({ do: '4', url: lineitem, userid: user, score: String(score), points: '100', grade: '', progress: 'Completed', gprogress: 'FullyGraded', comment: '' })) body.set(key, value)
      const data = JSON.parse((await request('/tp-score.php', body)).html)
      return { ok: Boolean(data.http?.ok), status: data.http?.status ?? null }
    },
  }
}
