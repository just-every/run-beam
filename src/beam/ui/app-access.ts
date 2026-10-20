// CONNECT-014: Access, where the owner issues, rotates and revokes application credentials. A new or rotated token
// is shown once on its own page and never again.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { AUDIENCES, RATE_PER_MINUTE, issueCredential, listCredentials, rotateCredential } from '../app-credentials'
import { all } from '../core'
import type { Input } from '../input'
import { card, checks, field, form, h, hidden, page, select, when } from './html'

const AUDIENCE_LABELS: Record<string, string> = { 'roster.read': 'Read the roster (GET /api/beam/v1/people)', 'catalog.read': 'Read the catalog (GET /api/beam/v1/courses)', 'enrollments.write': 'Enroll people (POST /api/beam/v1/enrollments)', 'reports.read': 'Read the training report (GET /api/beam/v1/report)', 'results.write': 'Submit external results for review (POST /api/beam/v1/results)' }

export async function accessPage(env: Bindings, actor: Actor, url: URL) {
  const [credentials, teams] = await Promise.all([listCredentials(env, actor), all(env, 'SELECT id, name FROM beam_teams ORDER BY name')])
  const zone = actor.shell?.zone ?? 'UTC'
  const teamName = new Map(teams.map(team => [team.id, team.name]))
  const list = credentials.length ? h`<div class="table-wrap"><table class="stacked"><thead><tr><th scope="col">Name</th><th scope="col">Audience</th><th scope="col">Teams</th><th scope="col">Expires</th><th scope="col">State</th></tr></thead><tbody>${credentials.map(item => h`<tr><td>${item.name}</td><td>${item.audience}</td><td>${item.teams.map((team: string) => teamName.get(team)).join(', ') || 'Whole business'}</td><td>${when(item.expiresAt, zone)}</td><td>${item.state}${item.state === 'active' ? h`${rotateForm(item.id)}${form('app.revoke', '/app/access', hidden('credential', item.id), 'Revoke', { secondary: true })}` : ''}</td></tr>`)}</tbody></table></div>` : h`<p>No application credentials yet.</p>`
  const issue = h`<form method="post" action="/app/access/issue">${[field('Name', 'name'), select('Audience', 'audience', AUDIENCES.map(value => ({ value, label: AUDIENCE_LABELS[value] }))), checks('Teams (none ticked: the whole business)', 'teams', teams.map(team => ({ value: team.id, label: team.name }))), field('Expires after (days, 1 to 90)', 'expiresInDays', { type: 'number', value: 30 })]}<button type="submit">Issue credential</button></form>`
  return page('Access', actor, h`<h1>Access</h1><p class="lede">Application credentials for your other systems. Each one reaches one audience and only its teams, expires, is limited to ${RATE_PER_MINUTE} requests a minute, and can never publish, change roles or act as a person.</p>${card('Credentials', list)}${card('Issue a credential', issue)}`, { current: '/app/access', url })
}

const rotateForm = (id: string) => h`<form method="post" action="/app/access/rotate">${hidden('credential', id)}<button type="submit" class="secondary">Rotate</button></form>`

export async function issuedPage(env: Bindings, actor: Actor, input: Input, url: URL, rotate: boolean) {
  const issued = rotate ? await rotateCredential(env, actor, input) : await issueCredential(env, actor, input)
  const response = page('Application credential', actor, h`<h1>${rotate ? 'Rotated credential' : 'New credential'}</h1><p>Copy this token now. It is shown once${rotate ? ' and the previous token no longer works' : ''}. Send it as <code>Authorization: Bearer …</code>.</p><p class="dashboard-link"><code data-token>${issued.token}</code></p><p>Audience ${issued.audience}; expires ${when(issued.expiresAt, 'UTC')}.</p><p><a href="/app/access">Back to Access</a></p>`, { current: '/app/access', url })
  response.headers.set('cache-control', 'no-store')
  response.headers.set('referrer-policy', 'no-referrer')
  return response
}
