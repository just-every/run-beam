import assert from 'node:assert/strict'

// Follow the same cookie/redirect sequence as a browser, then reload after the
// result cookie has been cleared. All calls enter through public HTTP routes.
export async function formResult(h, path, cookie, form) {
  const posted = await h.raw(path, { cookie, form })
  assert.equal(posted.status, 303, `${path} redirects after writing`)
  const location = posted.headers.get('location')
  assert.ok(location?.startsWith('/app/') && !location.includes('?') && !location.includes('#'), 'result address carries no secret')
  const sealed = posted.headers.getSetCookie().find(line => line.startsWith('beam_form_result='))
  assert.ok(sealed?.includes('HttpOnly') && sealed.includes('SameSite=Strict'), 'result transport is a private cookie')
  assert.equal(posted.headers.get('cache-control'), 'no-store')
  assert.equal(posted.headers.get('referrer-policy'), 'no-referrer')
  const resultCookie = sealed.split(';')[0]
  // A signed-out visitor must not be able to open this result.
  const stranger = await h.raw(location, { cookie: resultCookie })
  assert.equal(stranger.status, 303)
  const tampered = await h.raw(location, { cookie: `${cookie}; beam_form_result=invalid` })
  assert.equal(tampered.status, 303, 'a tampered result is refused')
  const opened = await h.raw(location, { cookie: `${cookie}; ${resultCookie}` })
  assert.equal(opened.status, 200)
  assert.equal(opened.headers.get('cache-control'), 'no-store')
  assert.equal(opened.headers.get('referrer-policy'), 'no-referrer')
  assert.ok(opened.headers.getSetCookie().some(line => line.startsWith('beam_form_result=;') && line.includes('Max-Age=0')), 'opening the result clears it')
  const text = await opened.text()
  const reloaded = await h.raw(location, { cookie })
  assert.equal(reloaded.status, 303, 'reloading the GET result returns to its list')
  assert.ok(!await reloaded.text(), 'reload never repeats the secret')
  return text
}
