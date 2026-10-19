// LEARN-013: the Recognition page. A learner sees their own points, badges and levels and chooses whether they appear
// on leaderboards; each team's activity leaderboard carries its label; administrators set points, badges, team levels,
// leaderboards and challenges. My learning shows a short recognition card when anything is switched on.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all } from '../core'
import { recognitionView, type RecognitionView } from '../recognition'
import { formatDate, formatDay } from '../time'
import { area, card, count, field, form, h, hidden, page, raw, rows, select } from './html'

const checkbox = (label: string, name: string, checked: boolean) => h`<label class="check"><input type="checkbox" name="${name}" value="on"${checked ? raw(' checked') : ''}> ${label}</label>`
const points = (value: number) => `${count(value)} ${value === 1 ? 'point' : 'points'}`
const milestone = (badge: RecognitionView['badges'][number]) => badge.milestone === 'course' ? `Finish “${badge.courseTitle}”` : `Finish ${badge.courses} different ${badge.courses === 1 ? 'course' : 'courses'}`
const CHALLENGE_STATE: Record<string, string> = { upcoming: 'starts', running: 'running', ended: 'ended' }

function mineCard(view: RecognitionView) {
  const { me } = view
  return card('My recognition', h`<p>${points(me.points)} from ${count(me.lessons)} ${me.lessons === 1 ? 'lesson' : 'lessons'} and ${count(me.courses)} ${me.courses === 1 ? 'course' : 'courses'} finished${me.levels.map(item => h` · level ${item.level} in ${item.groupName}`)}.</p>
${me.badges.length ? rows(me.badges.map(badge => ({ title: badge.name, meta: `${badge.description} · earned ${formatDate(badge.earnedAt, view.zone)}` }))) : h`<p class="muted">No badges yet.</p>`}
<p class="muted">${me.visible ? 'You appear on your teams’ and cohorts’ activity leaderboards and count toward their challenges.' : me.choice === 'out' ? 'You have opted out: you appear on no leaderboard and count toward no challenge. Only you see this card.' : 'You are not on any leaderboard yet.'}</p>
${me.choice === null ? '' : form('recognition.visibility', '/app/recognition', [hidden('visible', me.visible ? 'no' : 'yes')], me.visible ? 'Opt out of public recognition' : 'Show me on leaderboards again', { secondary: true })}`, { id: 'my-recognition' })
}

const groupLabel = (group: { kind: string; name: string }) => group.kind === 'audience' ? `${group.name} (cohort)` : group.name

function groupCard(team: RecognitionView['groups'][number]) {
  if (!team.leaderboard && !team.challenges.length) return ''
  return card(groupLabel(team), h`${team.leaderboard ? h`<h3>Activity leaderboard</h3><p class="muted">${team.leaderboardLabel}</p>${team.leaderboard.length ? h`<ol class="leaderboard">${team.leaderboard.map(row => h`<li><strong>${row.name}</strong> — ${points(row.points)}${row.level ? ` · level ${row.level}` : ''}${row.badges ? ` · ${row.badges} ${row.badges === 1 ? 'badge' : 'badges'}` : ''}</li>`)}</ol>` : h`<p>Nobody to show yet.</p>`}` : ''}
${team.challenges.length ? h`<h3>Challenges</h3>${rows(team.challenges.map(item => ({ title: item.name, meta: `${count(item.completions)} of ${count(item.goal)} course completions · ${formatDay(item.startsOn)} to ${formatDay(item.endsOn)} · ${CHALLENGE_STATE[item.state]}${item.met ? ' · goal reached' : ''}` })))}` : ''}`, { id: `${team.kind}-${team.id}` })
}

async function adminCards(env: Bindings, view: RecognitionView) {
  if (!view.configurable.length && !view.canSetPoints) return ''
  const courses = view.canSetPoints ? await all(env, 'SELECT id, title FROM beam_courses ORDER BY title') : []
  const groupOptions = view.configurable.map(group => ({ value: `${group.kind}:${group.id}`, label: groupLabel(group) }))
  const pointsCard = view.canSetPoints ? card('Points and badges', h`<p class="muted">Points come only from lessons and courses finished. Badges mark one milestone each. Neither changes completion rules, certificates or attempts.</p>
${form('recognition.points', '/app/recognition', [field('Points per lesson finished', 'lessonPoints', { type: 'number', value: view.settings.lessonPoints }), field('Points per course completed', 'coursePoints', { type: 'number', value: view.settings.coursePoints })], 'Save points', { secondary: true })}
${view.badges.length ? rows(view.badges.map(badge => ({ title: badge.name, meta: `${milestone(badge)} · ${badge.description}`, aside: form('recognition.badge.retire', '/app/recognition', [hidden('badge', badge.id)], 'Retire', { secondary: true }) }))) : ''}
<details><summary>Add a badge</summary>${form('recognition.badge', '/app/recognition', [field('Name', 'name'), area('What it recognizes', 'description'), select('Milestone', 'milestone', [{ value: 'course', label: 'Finish one course' }, { value: 'courses', label: 'Finish a number of different courses' }]), select('Course (for “finish one course”)', 'course', courses.map(row => ({ value: row.id, label: row.title })), '', { required: false, blank: 'No course' }), field('Number of courses (for “a number of courses”)', 'courses', { type: 'number', required: false })], 'Add the badge')}</details>`, { id: 'recognition-points' }) : ''
  const teamsCard = view.configurable.length ? card('Levels, leaderboards and challenges', h`<p class="muted">For a team or a cohort (an audience on Automation).</p>${view.configurable.map(team => h`<details><summary>${groupLabel(team)}${team.leaderboard ? ' · leaderboard on' : ''}${team.levels ? ` · levels every ${team.levelPoints} points` : ''}</summary>${form('recognition.group', '/app/recognition', [hidden('kind', team.kind), hidden('group', team.id), checkbox('Levels', 'levels', team.levels), field('Points per level', 'levelPoints', { type: 'number', value: team.levelPoints }), checkbox('Activity leaderboard', 'leaderboard', team.leaderboard)], 'Save', { secondary: true })}</details>`)}
<details><summary>Add a challenge</summary><p class="muted">Counts course completions by the group’s current members who have not opted out, from the start of the first day to the end of the last day in the business’s time zone.</p>${form('recognition.challenge', '/app/recognition', [select('Team or cohort', 'group', groupOptions), field('Name', 'name'), field('Course completions to reach', 'goal', { type: 'number' }), field('First day', 'startsOn', { type: 'date' }), field('Last day', 'endsOn', { type: 'date' })], 'Add the challenge')}</details>`, { id: 'recognition-teams' }) : ''
  return h`${pointsCard}${teamsCard}`
}

/** ct 19 Oct 12:42Z: before anyone appears on a leaderboard they see this once, with the way to opt out. */
function noticeCard(view: RecognitionView, returnTo: string) {
  if (!view.me.noticeDue) return ''
  return card('Recognition is on for your team', h`<p>Your team or cohort now has an activity leaderboard. ${view.label} It shows your name, points, level and badge count to your team or cohort, its managers and administrators. You appear on it only after you choose here, and you can opt out now or at any time on Recognition.</p>
${form('recognition.visibility', returnTo, [hidden('visible', 'yes')], 'Show me on leaderboards')}${form('recognition.visibility', returnTo, [hidden('visible', 'no')], 'Opt out of public recognition', { secondary: true })}`, { id: 'recognition-notice' })
}

export async function recognitionPage(env: Bindings, actor: Actor, url: URL) {
  const view = await recognitionView(env, actor)
  const body = h`<h1>Recognition</h1><p class="muted">${view.label}</p>${noticeCard(view, '/app/recognition')}${mineCard(view)}${view.groups.map(groupCard)}${await adminCards(env, view)}`
  return page('Recognition', actor, body, { current: '/app/recognition', url })
}

/** My learning: points, level and badges in one line when recognition is switched on. */
export async function recognitionCard(env: Bindings, actor: Actor) {
  const view = await recognitionView(env, actor)
  const on = view.settings.lessonPoints || view.settings.coursePoints || view.badges.length || view.me.levels.length
  if (view.me.noticeDue) return noticeCard(view, '/app/learning')
  if (!on) return ''
  const { me } = view
  return card('Recognition', h`<p>${points(me.points)}${me.levels.map(item => h` · level ${item.level} in ${item.groupName}`)}${me.badges.length ? ` · badges: ${me.badges.map(badge => badge.name).join(', ')}` : ''}. <a href="/app/recognition">See recognition</a></p>`, { id: 'recognition' })
}
