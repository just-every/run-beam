// Test tooling only. All native state is prepared through production HTTP doors.
const installations = new Map()

export function requireThat(condition, message) {
  if (!condition) throw new Error(message)
}

export function sessionCookie(response) {
  const cookie = response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
  requireThat(cookie.length > 0, 'Native authentication returned no session')
  return cookie
}

export function rememberInstallation(origin, state) {
  installations.set(origin, state)
}

export function installation(origin) {
  const state = installations.get(origin)
  requireThat(state, 'Native owner lifecycle has not completed')
  return state
}

export function nativeHttp({ request, origin, cookie }) {
  const fetch = (path, init = {}) => {
    const url = new URL(path, origin)
    requireThat(url.origin === origin, 'Native fixture request escaped its installation')
    return request(url.href, { ...init, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...init.headers } })
  }
  async function json(path, body, status = 200) {
    const response = await fetch(path, body === undefined ? {} : {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    // Never include response bodies, inputs, mail, cookies or credentials in failures.
    requireThat(response.status === status, `Native ${path.split('?')[0]} returned HTTP ${response.status}`)
    return response.json()
  }
  const api = (path, body, status) => json(`/api/beam/${path}`, body, status)
  async function form(path, fields) {
    const body = new URLSearchParams()
    for (const [key, value] of Object.entries(fields)) for (const item of [value].flat()) body.append(key, String(item))
    const response = await fetch(path, { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body })
    requireThat(response.status === 303, `Native ${path} returned HTTP ${response.status}`)
    const location = new URL(response.headers.get('location'), origin)
    requireThat(location.origin === origin && !location.searchParams.has('error'), `Native ${path} refused its form`)
    return response
  }
  return { fetch, json, api, form }
}

export const file = (filename, text, type = 'text/plain') => ({ filename, base64: Buffer.from(text).toString('base64'), type })

export function futureDay(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}
