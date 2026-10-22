import { t } from '../messages'
// NOTICE-006 on the pages: a sender writes an announcement to a team or a course's learners and reads the private
// replies; a learner sees the announcements sent to them on My learning and replies privately.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { isManager } from '../actor'
import { announcementSessions } from '../announcement-authority'
import { announcements } from '../announcements'
import { all } from '../core'
import { listCourses } from '../courses'
import { teamScope } from '../scope'
import { area, card, field, form, h, hidden, page, rows, select, when } from './html'

export async function announcementsPage(env: Bindings, actor: Actor, url: URL) {
  const scope = teamScope(actor)
  const [list, teams, courses, sessions] = await Promise.all([announcements(env, actor), all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_teams WHERE (? IS NULL OR id IN (SELECT value FROM json_each(?))) ORDER BY name', scope, scope), listCourses(env), announcementSessions(env, actor)])
  const zone = actor.shell!.zone
  const management = isManager(actor) || actor.adminUnits.length > 0
  const audiences = [...(management ? teams : []).map(team => ({ value: `team:${team.id}`, label: team.name, group: 'Teams' })), ...(management ? courses : []).filter(course => course.publishedRevision).map(course => ({ value: `course:${course.id}`, label: course.title, group: 'Learners of a course' })), ...sessions.map(session => ({ value: `session:${session.id}`, label: session.title, group: 'Registered session learners' }))]
  const body = h`<h1>Announcements</h1><p class="lede">Write to the people of a team, the learners of a course you look after, or the registered learners of a scheduled session you administer or lead. Each person sees it on My learning with your name, never who else received it, and can reply to you privately. It is delivered in Beam only: email, Slack and Teams delivery are not sent yet.</p>
${audiences.length ? card('New announcement', form('announcement.send', '/app/announcements', [select('To', 'audience', audiences), field('Title', 'title'), area('Message', 'body')], 'Send announcement')) : h`<p>No announcement audience is currently available.</p>`}
${list.sent.map(row => card(row.title, h`<p class="muted">To ${row.audienceName} · ${row.recipients} ${row.recipients === 1 ? 'person' : 'people'} · ${when(row.sentAt, zone)} · delivered in Beam</p><p>${row.body}</p>${!row.repliesOpen ? h`<p class="muted">Replies are closed while you do not hold access to this scheduled session.</p>` : row.replies.length ? h`<h3>Private replies</h3>${rows(row.replies.map((reply: any) => ({ title: reply.learnerName, meta: h`${when(reply.sentAt, zone)}: ${reply.body}` })))}` : h`<p class="muted">No replies yet.</p>`}`))}`
  return page('Announcements', actor, body, { current: '/app/announcements', url })
}

/** On My learning: the announcements sent to this person, with a private reply. A read-only view (ORG-012) shows the
 * announcements but not the person's replies, which stay between them and the sender. */
export function receivedCard(received: Awaited<ReturnType<typeof announcements>>['received'], actor: Actor, zone: string) {
  if (!received.length) return ''
  return card(t(actor, 'Announcements'), received.map(row => h`<section class="announcement"><h3>${row.title}</h3><p class="muted">${t(actor, 'From {name}', { name: row.senderName })} · ${when(row.sentAt, zone, zone, actor.locale)}</p><p>${row.body}</p>
${actor.viewAs ? '' : h`${row.replies.map((reply: any) => h`<p class="muted">${t(actor, 'Your reply {date}: {body}', { date: when(reply.sentAt, zone, zone, actor.locale), body: reply.body })}</p>`)}${row.repliesOpen ? h`<details><summary>${t(actor, 'Reply privately to {name}', { name: row.senderName })}</summary>${form('announcement.reply', '/app/learning', [hidden('announcement', row.id), area(t(actor, 'Your reply'), 'body')], t(actor, 'Send reply'), { secondary: true })}</details>` : h`<p class="muted">${t(actor, 'Replies are closed because the sender no longer has access to this scheduled session.')}</p>`}`}</section>`), { id: 'announcements' })
}
