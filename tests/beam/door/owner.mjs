import { initializeLearners } from './learners.mjs'
import { nativeHttp, rememberInstallation, requireThat, sessionCookie } from './native.mjs'

export default async function initializeOwner({ request, origin, email, claim, token, displayName, reviewers }) {
  // The manifest currently uses setup-token; the verifier supplies its actual
  // native /auth/bootstrap path. Signed claims keep their supplied claim path.
  const path = claim?.path ?? (claim?.mode === 'signed' ? '/auth/owner-claim' : '/auth/bootstrap')
  const response = await request(new URL(path, origin).href, {
    method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ token: claim?.token ?? token, displayName: displayName ?? 'Sierra Lakes owner', returnTo: '/setup' }),
  })
  requireThat(response.status === 303 && !response.redirected, 'Native owner claim failed')
  const cookie = sessionCookie(response), http = nativeHttp({ request, origin, cookie })
  await http.form('/setup', { confirm: 'yes' })
  const owner = await http.api('me')
  requireThat(owner.owner && owner.email === email, 'Native Beam owner membership was not established')
  await http.api('business.configure', { name: 'Sierra Lakes Produce', timezone: 'UTC' })
  const [reviewerSession, staff] = await Promise.all([
    reviewers.initialize('quality', { cookie }),
    initializeLearners({ request, origin, cookie }),
  ])
  const reviewer = await nativeHttp({ request, origin, cookie: reviewerSession.cookie }).api('me')
  rememberInstallation(origin, { owner: owner.id, reviewer: { id: reviewer.id, cookie: reviewerSession.cookie }, ...staff })
  // Return the unchanged native 303, including its real session cookie.
  return response
}
