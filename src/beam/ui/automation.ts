// AUTO-005 on the page: Automation lists the follow-on rules this person manages, with their dry run, state and latest
// runs, and saves new rules. A rule stays a draft until its dry run is recorded; then it can be enabled, paused and
// replayed. Nothing here edits a saved rule: a changed rule is a new one.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { automationView } from '../automation'
import { all } from '../core'
import { listCourses } from '../courses'
import { teamScope } from '../scope'
import { automationControlsCard } from './automation-controls'
import { audienceCards } from './audiences'
import { card, field, form, h, hidden, page, rows, select, when } from './html'

const TRIGGER: Record<string, string> = { enrollment: 'is enrolled in', completion: 'completes', failure: 'runs out of quiz attempts on' }
const OUTCOME: Record<string, string> = { would_assign: 'would assign', assigned: 'assigned', already_open: 'already open', already_ran: 'already done by this rule', target_unavailable: 'target course not available', depth_limit: 'stopped: chain too long' }
const STATE: Record<string, string> = { draft: 'Draft: run a dry run first', active: 'Active', paused: 'Paused' }

export async function automationPage(env: Bindings, actor: Actor, url: URL) {
  const scope = teamScope(actor)
  const [view, courses, teams] = await Promise.all([automationView(env, actor), listCourses(env, actor.owner ? undefined : { units: actor.adminUnits }), all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_teams WHERE (? IS NULL OR id IN (SELECT value FROM json_each(?))) ORDER BY name', scope, scope)])
  const zone = actor.shell!.zone
  const options = courses.filter(course => course.publishedRevision && !course.retiredAt).map(course => ({ value: course.id, label: course.title }))
  const ruleCard = (rule: any) => {
    const preview = rule.preview, runs = view.runs.filter(run => run.rule === rule.id).slice(0, 10)
    return card(rule.name, h`<p>When a learner ${TRIGGER[rule.trigger]} <strong>${rule.sourceTitle}</strong>${rule.minPercent !== null ? ` with a best quiz score of at least ${rule.minPercent}%` : ''}${rule.teamName ? ` (team ${rule.teamName} only)` : ''}, assign <strong>${rule.targetTitle}</strong> due in ${rule.dueDays} ${rule.dueDays === 1 ? 'day' : 'days'}.</p>
<p class="muted">${STATE[rule.state]}${rule.enabledAt ? ` · enabled ${when(rule.enabledAt, zone)}` : ''}</p>
${preview ? h`<p class="muted">Dry run ${when(preview.at, zone)}: ${Object.entries(preview.counts).filter(([, n]) => n).map(([kind, n]) => `${n} ${OUTCOME[kind]}`).join(', ') || 'no matching learners'}. Nothing was assigned.</p>${preview.items.length ? rows(preview.items.slice(0, 10).map((item: any) => ({ title: item.learner, meta: OUTCOME[item.outcome] }))) : ''}` : ''}
${form('automation.preview', '/app/automation', [hidden('rule', rule.id)], 'Dry run', { secondary: true })}
${rule.state !== 'active' && preview ? form('automation.state', '/app/automation', [hidden('rule', rule.id), hidden('state', 'active')], 'Enable') : ''}
${rule.state === 'active' ? h`${form('automation.replay', '/app/automation', [hidden('rule', rule.id)], 'Replay past events', { secondary: true })}${form('automation.state', '/app/automation', [hidden('rule', rule.id), hidden('state', 'paused')], 'Pause', { secondary: true })}` : ''}
${runs.length ? h`<h3>Latest runs</h3>${rows(runs.map(run => ({ title: run.learnerName, meta: `${OUTCOME[run.outcome]}${run.replay ? ' (replay)' : ''} · ${when(run.at, zone)}`, href: run.targetAssignment ? `/app/learn/${run.targetAssignment}` : undefined })))}` : ''}`)
  }
  const audiences = await audienceCards(env, actor, zone, options)
  const body = h`<h1>Automation</h1><p class="lede">Follow-on rules assign the next course when a learner is enrolled in, completes or runs out of quiz attempts on a course. A rule acts once per event, never changes the source course's result, and runs only after its dry run.</p>
${await automationControlsCard(env, actor, zone)}
${view.rules.map(ruleCard)}
${card('New follow-on rule', form('automation.save', '/app/automation', [field('Name', 'name'), select('When a learner', 'trigger', [{ value: 'completion', label: 'completes' }, { value: 'failure', label: 'runs out of quiz attempts on' }, { value: 'enrollment', label: 'is enrolled in' }]), select('Course', 'sourceCourse', options), select('Assign', 'targetCourse', options), field('Due in (days)', 'dueDays', { type: 'number', value: 14 }), field('Only with a best quiz score of at least (%)', 'minPercent', { type: 'number', required: false, hint: 'Completions only; leave empty for every completion.' }), select('Only for team', 'team', teams.map(team => ({ value: team.id, label: team.name })), '', { required: false, blank: 'Everyone' })], 'Save as draft'))}
${audiences}`
  return page('Automation', actor, body, { current: '/app/automation', url })
}
