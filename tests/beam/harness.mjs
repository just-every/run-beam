// Drives the built Worker (tests/runtime.mjs) only through public HTTP doors.
import assert from 'node:assert/strict'
import { emittedWorker } from '../runtime.mjs'

export async function harness(options) {
  const { origin, vars, mails, edge, fetch, linkFor, close, db, files, scheduled } = await emittedWorker(options)

  const raw = (path, { cookie, body, form, method, headers = {} } = {}) => fetch(path, {
    method: method ?? (body !== undefined || form ? 'POST' : 'GET'),
    headers: { ...headers, ...(cookie ? { cookie } : {}), ...(body !== undefined || form ? { origin } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
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
  async function signIn(email, { requested = false, sourceIp } = {}) {
    const sent = mails.length, headers = sourceIp ? {'CF-Connecting-IP':sourceIp} : {}
    if (!requested) assert.equal((await raw('/auth/magic-link', { body: { email, returnTo: '/app' }, headers })).status, 202)
    const link = linkFor(email)
    assert.ok(link && (requested || mails.length > sent), `no sign-in message for ${email}`)
    const confirmed = await raw('/auth/confirm', { body: { token: link.searchParams.get('token') }, headers })
    assert.equal(confirmed.status, 303, 'ordinary link confirmation')
    return confirmed.headers.getSetCookie().map(line => line.split(';')[0]).join('; ')
  }

  return { origin, vars, mails, edge, fetch, raw, api, submit, signIn, close, db, files, scheduled }
}

export const file = (filename, content, type = 'application/octet-stream') => ({ filename, base64: Buffer.from(content).toString('base64'), type })
