// AUTO-007 on the pages: the owner's inactivity policy on People, with what a run would do now and every notice; and a
// person's own notice on My learning. Notices are shown in Beam only; no email is sent.
import type { Bindings } from '../../auth.server'
import { ROLES, type Actor } from '../actor'
import { inactivityView, myNotice, plan } from '../inactivity'
import { inactivityAuth } from '../inactivity-scheduled'
import { card, checks, field, form, h, hidden, rows, when } from './html'

const ROLE_LABELS: Record<string, string> = { author: 'Authors', reviewer: 'Reviewers', learner: 'Learners', manager: 'Managers', assessor: 'Assessors' }
const STATE: Record<string, string> = { open: 'notice open', cancelled: 'cancelled', deactivated: 'access removed' }

export async function inactivityCard(env: Bindings, actor: Actor, teams: { id: string; name: string }[], zone: string, request: Request) {
  if (!actor.owner) return ''
  const { policy, notices } = await inactivityView(env, actor)
  const now = policy ? await plan(env, policy) : null
  const door = (await inactivityAuth(env)).scheduledPolicies!
  const approval = policy ? await door.list(request) : null
  const current = approval?.policies[0]
  const history = policy ? await door.runs(request) : null
  const scheduled = current ? h`<h3>Daily automatic run</h3><p>At 08:00 UTC, at most 100 removals per run, at least 23 hours between runs. An ordinary owner sign-in must approve this exact definition. No automatic retries or external provider calls.</p><p>Status: ${current.state}</p><details><summary>Review automatic authority</summary><pre class="inactivity-definition">${JSON.stringify(current.definition, null, 2)}</pre><p class="inactivity-definition">SHA-256: ${current.versionHash}</p></details>${policy?.enabled ? form('inactivity.approve', '/app/people', [hidden('versionHash', current.versionHash)], 'Approve daily automatic run') : ''}${current.approval && !current.approval.revokedAt ? form('inactivity.revoke', '/app/people', [hidden('approvalId', current.approval.id)], 'Revoke automatic authority', { secondary: true }) : ''}${approval?.approvals.length ? rows(approval.approvals.map(item => ({ title: item.revokedAt ? `Revoked: ${item.revokeReason}` : 'Standing approval', meta: `Owner ${item.ownerId} · ${item.sessionKind} · ${when(item.approvedAt, zone)}` }))) : ''}${history?.runs.length ? rows(history.runs.map(run => ({ title: `${run.status}${run.error ? `: ${run.error}` : ''}`, meta: `${when(run.startedAt, zone)} · ${run.actions.length} action records · ${run.repeats} tick(s)` }))) : ''}${history?.nextCursor ? h`<a href="/auth/policy-runs?before=${history.nextCursor}">Older automatic run records (JSON)</a>` : ''}` : ''
  const settings = form('inactivity.policy', '/app/people', [field('Inactive after (days without signing in)', 'inactiveDays', { type: 'number', value: policy?.inactiveDays ?? 180 }), field('Notice before access is removed (days)', 'noticeDays', { type: 'number', value: policy?.noticeDays ?? 14 }),
    teams.length ? checks('Protected teams', 'excludedTeams', teams.map(team => ({ value: team.id, label: team.name })), policy?.excludedTeams ?? []) : '', checks('Protected roles', 'excludedRoles', ROLES.map(role => ({ value: role, label: ROLE_LABELS[role] })), policy?.excludedRoles ?? [])], 'Save policy', { secondary: true })
  const preview = now ? h`<p class="muted">A run now would give ${now.notify.length} ${now.notify.length === 1 ? 'notice' : 'notices'}, cancel ${now.cancel.length} and remove access for ${now.deactivate.length}; ${now.protected.length} protected (the owner, assessors with evidence waiting, people with an open blocker or exception, and the teams and roles above).</p>${rows([...now.notify.map(person => ({ title: person.name, meta: `would get a notice: no sign-in for ${person.idleDays} days` })), ...now.deactivate.map(notice => ({ title: notice.name, meta: 'access would be removed: the notice ran out' }))])}` : ''
  const controls = policy ? h`${form('inactivity.preview', '/app/people', [], 'Preview this policy', { secondary: true })}${policy.previewedVersion === policy.version ? form('inactivity.enable', '/app/people', [hidden('enabled', policy.enabled ? 'false' : 'true')], policy.enabled ? 'Switch off' : 'Switch on', { secondary: true }) : ''}${policy.enabled ? form('inactivity.run', '/app/people', [], 'Run now') : ''}` : ''
  return card('Inactive accounts', h`<p class="muted">${policy ? `Version ${policy.version}, ${policy.enabled ? 'on' : policy.previewedVersion === policy.version ? 'previewed, off' : 'off until previewed'}.` : 'No policy yet.'} People who have not signed in for the set days get a notice on My learning; if they still have not signed in when it runs out, their access is removed and their sessions end. Their training records stay. Restore access from People and they sign in again by emailed link. Notices are shown in Beam only; no email is sent.</p>
${settings}${preview}${controls}${scheduled}${notices.length ? rows(notices.slice(0, 20).map(notice => ({ title: notice.name, meta: `${STATE[notice.state]} · noticed ${when(notice.noticedAt, zone)}${notice.state === 'open' ? ` · access ends ${when(notice.deactivateAt, zone)}` : notice.closeReason ? ` · ${notice.closeReason}` : ''} · policy version ${notice.policyVersion}` }))) : ''}`, { id: 'inactivity' })
}

/** My learning: the person's own notice, while it is open. */
export async function noticeCard(env: Bindings, actor: Actor, zone: string) {
  if (actor.viewAs) return ''
  const notice = await myNotice(env, actor)
  return notice ? h`<p class="flash" role="status">You have not signed in to Beam since ${when(notice.lastSignInAt, zone)}. Your access ends ${when(notice.deactivateAt, zone)} unless you sign in again before then; your training records stay either way.</p>` : ''
}
