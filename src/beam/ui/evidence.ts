// ORG-005 on the pages: an auditor's shared evidence, and the owner's auditor grants on People.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { auditorGrants, sharedEvidence } from '../auditors'
import { business } from '../people'
import { formatDate } from '../time'
import { card, checks, field, form, h, hidden, page, rows, select, when } from './html'

const METHODS: Record<string, string> = { lessons: 'lessons', assessed: 'assessed', offline: 'offline attendance' }

export async function evidencePage(env: Bindings, actor: Actor, url: URL) {
  const [view, zone] = await Promise.all([sharedEvidence(env, actor), business(env).then(value => value!.timezone)])
  const body = h`<h1>Shared training evidence</h1><p class="lede">Read-only. Shared by the owner for ${view.grants.map(grant => `${formatDate(grant.periodFrom, zone)} to ${formatDate(grant.periodTo - 1, zone)}, until ${when(grant.expiresAt, zone)}`).join('; ')}.</p>
${card('Completions', view.completions.length ? rows(view.completions.map(row => ({ title: `${row.learnerName}: ${row.courseTitle} revision ${row.revisionNumber}`, meta: h`Completed ${formatDate(row.completedAt, zone)} (${METHODS[row.method] ?? row.method})${row.certificate ? h` · <a href="/app/certificates/${row.certificate}">certificate ${row.certificateNumber}</a>` : ''}${row.attachment ? h` · <a href="/app/files/attachment/${row.attachment}">evidence file</a>` : ''}` }))) : h`<p class="muted">No completions in this period.</p>`)}`
  return page('Shared evidence', actor, body, { current: '/app/evidence', url })
}

export async function auditorsCard(env: Bindings, actor: Actor, people: { id: string; name: string; owner?: boolean }[], teams: Record<string, any>[]) {
  if (!actor.owner) return ''
  const [grants, zone] = await Promise.all([auditorGrants(env), business(env).then(value => value!.timezone)])
  const teamName = (id: string) => teams.find(team => team.id === id)?.name ?? id
  return card('Auditors', h`<p class="muted">An auditor reads the completions, certificates and evidence files of chosen teams within a period, until an end date, and changes nothing.</p>
${grants.length ? rows(grants.map(grant => ({ title: `${grant.memberName}: ${grant.teams.map(teamName).join(', ')}`, meta: `${formatDate(grant.periodFrom, zone)} to ${formatDate(grant.periodTo - 1, zone)} · ${grant.state === 'active' ? `until ${when(grant.expiresAt, zone)}` : grant.state}`, aside: grant.state === 'active' ? form('auditor.revoke', '/app/people', [hidden('grant', grant.id)], 'Revoke', { secondary: true }) : '' }))) : ''}
${teams.length ? h`<details><summary>Share evidence with an auditor</summary>${form('auditor.grant', '/app/people', [select('Auditor', 'member', people.filter(person => !person.owner).map(person => ({ value: person.id, label: person.name }))), checks('Teams', 'teams', teams.map(team => ({ value: team.id, label: team.name }))), field('Completed from', 'periodFrom', { type: 'date' }), field('Completed through', 'periodTo', { type: 'date' }), field('Access ends after', 'expiresOn', { type: 'date' })], 'Share evidence')}</details>` : ''}`)
}
