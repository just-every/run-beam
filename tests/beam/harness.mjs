// Drives the built Worker (tests/runtime.mjs) only through public HTTP doors.
import assert from 'node:assert/strict'
import { emittedWorker } from '../runtime.mjs'

export async function harness(options) {
  const runtime = await emittedWorker(options)
  const { origin, vars, mails, edge, fetch, linkFor, close, scheduled, setClock } = runtime

  const raw = (path, { cookie, body, form, method } = {}) => fetch(path, {
    method: method ?? (body !== undefined || form ? 'POST' : 'GET'),
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined || form ? { origin } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : form,
  })

  /** The JSON door: GET reads a view, a body POSTs an action. Asserts the status and returns the JSON. */
  async function api(path, cookie, body, status = 200) {
    const response = await raw(`/api/beam/${path}`, { cookie, body })
    const text = await response.text()
    assert.equal(response.status, status, `${path}: ${response.status} ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : null
  }

  /** The HTML form door: returns the redirect target after a 303. */
  async function submit(action, cookie, fields, returnTo = '/app') {
    const form = new FormData()
    form.set('returnTo', returnTo)
    for (const [name, value] of Object.entries(fields)) for (const item of [value].flat()) form.append(name, item)
    const response = await raw(`/app/do/${action}`, { cookie, form })
    assert.equal(response.status, 303, `${action}: ${response.status}`)
    return new URL(response.headers.get('location'), origin)
  }

  /** Signs in through the ordinary emailed link (captured at the Resend edge). */
  async function signIn(email, { requested = false } = {}) {
    const sent = mails.length
    if (!requested) assert.equal((await raw('/auth/magic-link', { body: { email, returnTo: '/app' } })).status, 202)
    const link = linkFor(email)
    assert.ok(link && (requested || mails.length > sent), `no sign-in message for ${email}`)
    const confirmed = await raw('/auth/confirm', { body: { token: link.searchParams.get('token') } })
    assert.equal(confirmed.status, 303, 'ordinary link confirmation')
    return confirmed.headers.getSetCookie().map(line => line.split(';')[0]).join('; ')
  }

  async function configureAgentPolicy(cookie, trust) {
    const document = { schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1', rules: [{ id: 'prepared-work', class: '*', do: 'autonomous' }], spend: { none: true } }
    if (trust) {
      const { webcrypto } = await import('node:crypto')
      const { policyEnvelope } = await import('../../src/modules/agent-door/conformance/crypto.mjs')
      const kid = 'business-a'
      const privateKey = await webcrypto.subtle.importKey('jwk', trust.keys[kid].privateKey.export({ format: 'jwk' }), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
      const { policy } = await policyEnvelope({ origin, business: 'beam-http-tests', revision: 0, seq: 0,
        signer: { privateKey, kid, issuer: vars.RER_OWNER_CLAIM_ISSUER, installationId: vars.RER_OWNER_CLAIM_INSTALLATION_ID } }, document)
      const response = await fetch('/api/rer/agent-policy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ policy }) })
      assert.equal(response.status, 200, 'paired company adopts its signed preparation policy')
    } else {
      const response = await fetch('/agents/api/policy', { method: 'PUT', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ document }) })
      assert.equal(response.status, 200, 'owner chooses preparation policy through the native person door')
    }
  }

  return { configureAgentPolicy, origin, vars, mails, edge, fetch, raw, api, submit, signIn, close, get db() { return runtime.db }, get files() { return runtime.files }, scheduled, setClock }
}

export const file = (filename, content, type = 'application/octet-stream') => ({ filename, base64: Buffer.from(content).toString('base64'), type })
