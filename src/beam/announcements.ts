// NOTICE-006, in-app slice: the owner, a learning administrator or a manager writes an announcement to the learners of
// a team or a course within their authority (a course's learners are the people in their reach with an open
// assignment of it). Each recipient sees it in Beam with its sender, never the recipient list, and may reply
// privately: only the sender reads replies, and the audit records that a reply happened, never its words. Email,
// Slack and Teams delivery are not sent today; they come with NOTICE-001, NOTICE-002 and NOTICE-003.
import type { Bindings } from '../auth.server'
import { isManager, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { inScope, requireTeamScope } from './scope'
import { requireCourseRole } from './units'

const sender = (actor: Actor) => isManager(actor) || actor.adminUnits.length > 0

export async function sendAnnouncement(env: Bindings, actor: Actor, input: Input) {
  insist(sender(actor) && !actor.agent, 'forbidden', 403)
  const [kind, target] = input.text('audience', { max: 80 }).split(':')
  insist((kind === 'team' || kind === 'course') && target, 'invalid_audience')
  let learners: string[]
  if (kind === 'team') {
    insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ?', target), 'team_not_found', 404)
    requireTeamScope(actor, target)
    learners = (await all<{ member_id: string }>(env, 'SELECT member_id FROM beam_team_members WHERE team_id = ?', target)).map(row => row.member_id)
  } else {
    insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id = ?', target), 'course_not_found', 404)
    if (!isManager(actor)) await requireCourseRole(env, actor, target)
    learners = (await all<{ learner_id: string }>(env, "SELECT DISTINCT learner_id FROM beam_assignments WHERE course_id = ? AND status = 'open'", target)).map(row => row.learner_id).filter(learner => inScope(actor, learner))
  }
  learners = learners.filter(learner => learner !== actor.id)
  insist(learners.length > 0, 'no_recipients', 409)
  const title = input.text('title', { max: 160 }), body = input.text('body', { max: 4000 })
  const id = newId(), at = now()
  await commit(env, [
    stmt(env, 'INSERT INTO beam_announcements (id, sender_id, audience_kind, audience_id, title, body, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, actor.id, kind, target, title, body, at),
    ...learners.map(learner => stmt(env, 'INSERT INTO beam_announcement_recipients (announcement_id, learner_id) VALUES (?, ?)', id, learner)),
  ], { actor, action: 'announcement.send', subject: id, detail: { audience: `${kind}:${target}`, title, recipients: learners.length, delivered: 'in_app' } })
  return { id, recipients: learners.length, delivered: ['in_app'], notSent: ['email', 'slack', 'teams'] }
}

/** A recipient's private reply to the sender. */
export async function replyToAnnouncement(env: Bindings, actor: Actor, input: Input) {
  const id = input.text('announcement')
  insist(await one(env, 'SELECT 1 FROM beam_announcement_recipients WHERE announcement_id = ? AND learner_id = ?', id, actor.id), 'not_found', 404)
  const body = input.text('body', { max: 2000 }), reply = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_announcement_replies (id, announcement_id, learner_id, body, sent_at) VALUES (?, ?, ?, ?, ?)', reply, id, actor.id, body, now())],
    { actor, action: 'announcement.reply', subject: id, detail: {} })
  return { id: reply, announcement: id }
}

/** What this person received, with their own replies; and what they sent, with its recipients' count and replies. */
export async function announcements(env: Bindings, actor: Actor) {
  const received = await all(env, `SELECT a.id, a.title, a.body, a.sent_at AS sentAt, m.name AS senderName FROM beam_announcements a JOIN beam_announcement_recipients r ON r.announcement_id = a.id
    JOIN beam_members m ON m.id = a.sender_id WHERE r.learner_id = ? ORDER BY a.sent_at DESC, a.rowid DESC`, actor.id)
  const mine = await all(env, 'SELECT announcement_id AS announcement, body, sent_at AS sentAt FROM beam_announcement_replies WHERE learner_id = ? ORDER BY sent_at', actor.id)
  const sent = await all(env, `SELECT a.id, a.audience_kind AS audienceKind, a.audience_id AS audience, COALESCE(t.name, c.title) AS audienceName, a.title, a.body, a.sent_at AS sentAt,
    (SELECT COUNT(*) FROM beam_announcement_recipients r WHERE r.announcement_id = a.id) AS recipients FROM beam_announcements a
    LEFT JOIN beam_teams t ON a.audience_kind = 'team' AND t.id = a.audience_id LEFT JOIN beam_courses c ON a.audience_kind = 'course' AND c.id = a.audience_id WHERE a.sender_id = ? ORDER BY a.sent_at DESC, a.rowid DESC`, actor.id)
  const replies = await all(env, `SELECT p.id, p.announcement_id AS announcement, p.body, p.sent_at AS sentAt, m.name AS learnerName FROM beam_announcement_replies p JOIN beam_announcements a ON a.id = p.announcement_id
    JOIN beam_members m ON m.id = p.learner_id WHERE a.sender_id = ? ORDER BY p.sent_at`, actor.id)
  return {
    // A read-only view (ORG-012) shows the announcements, never the learner's own replies.
    received: received.map(row => ({ ...row, replies: actor.viewAs ? [] : mine.filter(reply => reply.announcement === row.id) }) as Row),
    sent: sent.map(row => ({ ...row, replies: replies.filter(reply => reply.announcement === row.id) }) as Row),
  }
}
