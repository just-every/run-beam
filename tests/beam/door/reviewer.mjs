import { nativeHttp, requireThat, sessionCookie } from './native.mjs'

const reviewers = new Map()
async function confirm({ request, origin, mail }, after) {
  const messages = await mail.read({ after, limit: 20 })
  let token
  for (const message of messages.toReversed()) {
    for (const match of `${message.text}\n${message.html}`.matchAll(/https?:\/\/[^\s<>"']+/g)) {
      let link
      try { link = new URL(match[0].replaceAll('&amp;', '&')) } catch { continue }
      if (link.origin === origin && link.pathname === '/auth/confirm' && link.searchParams.get('token')) {
        token = link.searchParams.get('token')
        break
      }
    }
    if (token) break
  }
  requireThat(token, 'Native reviewer mail did not contain a confirmation')
  const response = await request(new URL('/auth/confirm', origin).href, {
    method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }),
  })
  requireThat(response.status === 303 && !response.redirected, 'Native reviewer confirmation failed')
  return response
}

// The verifier captures only this declared synthetic reviewer's accepted mail.
export default async function initializeReviewer(context) {
  const { request, origin, email, owner } = context
  const ownerHttp = nativeHttp({ request, origin, cookie: owner.cookie })
  const after = Date.now()
  await ownerHttp.api('person.invite', { email, name: 'Sierra Lakes quality reviewer', roles: ['reviewer', 'learner'] })
  const response = await confirm(context, after)
  const reviewer = await nativeHttp({ request, origin, cookie: sessionCookie(response) }).api('me')
  requireThat(!reviewer.owner && reviewer.email === email && reviewer.roles.includes('reviewer'), 'Native reviewer authority was not established')
  reviewers.set(origin, context)
  return response
}

/** Reactivation cannot revive a revoked session; confirm a fresh native email link. */
export async function refreshReviewer(origin) {
  const context = reviewers.get(origin)
  requireThat(context, 'Native reviewer lifecycle is unavailable')
  const after = Date.now()
  const response = await context.request(new URL('/auth/magic-link', origin).href, {
    method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email: context.email, returnTo: '/app' }),
  })
  requireThat(response.status === 202, 'Native reviewer sign-in request failed')
  await response.body?.cancel()
  return sessionCookie(await confirm(context, after))
}
