// AUTHOR-006: accountable content upkeep. A course's responsible owner is its catalog owner (AUTHOR-005), else its
// named reviewer; whoever manages its catalog also names a fallback owner and a next review date, a calendar date in
// the business time zone. The daily scheduled job opens a review for each unretired course whose date has come, then
// mails every open review and source-change notice to the responsible owner. When that person is unavailable (no active
// sign-in, or employment ended) it escalates to the fallback owner, and when the fallback owner is unset or unavailable
// too, to the installation owner acting as admin. Each mail runs under AUTO-008's controls: a paused policy, quiet hours
// or the daily ceiling hold it, and a refused or failed send is recorded with its reason and never retried by itself;
// the owner's explicit run replays it. One item is mailed to one person at most once. Decisions (no material change, or
// the draft is being updated) carry a note and a next review date after today, which becomes the course's next date.
import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { requireOwner, type Actor } from './actor'
import { controlledExecution } from './automation-execution'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import { loadCourse } from './courses'
import type { Input } from './input'
import { business, requireBusiness } from './people'
import { localDate } from './time'
import { requireCourseRole } from './units'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const RULE = 'content-upkeep'
export const DECISIONS = ['no_material_change', 'draft_updated'] as const
const AVAILABLE = `SELECT m.id, m.name, m.email FROM beam_members m JOIN oa_operators o ON o.id = m.operator_id
  WHERE o.status = 'active' AND m.employment <> 'terminated'`

/** A next review date: a real calendar date after today in the business time zone. */
export const nextReviewDate = (env: Bindings, input: Input) => futureDate(env, input.text('nextReviewOn', { max: 10 }))

/** A real calendar date after today in the business time zone. */
export async function futureDate(env: Bindings, value: string) {
  insist(DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), 'invalid_review_date')
  insist(value > localDate(now(), (await requireBusiness(env)).timezone), 'review_date_not_after_today')
  return value
}

export async function saveUpkeep(env: Bindings, actor: Actor, input: Input) {
  const course = await loadCourse(env, input.text('course'))
  await requireCourseRole(env, actor, course.id)
  const fallbackOwner = input.text('fallbackOwner', { optional: true }) || null
  if (fallbackOwner) insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', fallbackOwner), 'person_not_found', 404)
  const nextReviewOn = await nextReviewDate(env, input)
  await commit(env, [stmt(env, 'UPDATE beam_courses SET fallback_owner_id = ?, next_review_on = ? WHERE id = ?', fallbackOwner, nextReviewOn, course.id)],
    { actor, action: 'course.upkeep', subject: course.id, detail: { fallbackOwner, nextReviewOn } })
  return { id: course.id, fallbackOwner, nextReviewOn }
}

/** The installation owner or the course's named reviewer records a scheduled review's decision. */
export async function decideReview(env: Bindings, actor: Actor, input: Input) {
  const review = await one(env, 'SELECT r.*, c.reviewer_id FROM beam_content_reviews r JOIN beam_courses c ON c.id = r.course_id WHERE r.id = ?', input.text('review'))
  insist(review, 'review_not_found', 404)
  insist(actor.owner || (actor.roles.has('reviewer') && review.reviewer_id === actor.id), 'named_reviewer_required', 403)
  insist(review.state === 'open', 'review_decided', 409)
  const decision = input.text('decision')
  insist((DECISIONS as readonly string[]).includes(decision), 'invalid_decision')
  const note = input.text('note', { max: 2000 }), nextReviewOn = await nextReviewDate(env, input)
  await commit(env, [
    stmt(env, "UPDATE beam_content_reviews SET state = ?, note = ?, next_review_on = ?, decided_by = ?, decided_at = ? WHERE id = ? AND state = 'open'", decision, note, nextReviewOn, actor.id, now(), review.id),
    stmt(env, 'UPDATE beam_courses SET next_review_on = ? WHERE id = ?', nextReviewOn, review.course_id),
  ], { actor, action: `review.${decision}`, subject: review.id, detail: { course: review.course_id, dueOn: review.due_on, note, nextReviewOn } })
  return { id: review.id, state: decision, nextReviewOn }
}

/** Who an item reaches now: the responsible owner, else the fallback owner, else the installation owner. */
async function route(env: Bindings, item: Row) {
  const responsible = item.owner_id ?? item.reviewer_id
  const available = async (id: string | null) => id ? await one(env, `${AVAILABLE} AND m.id = ?`, id) : null
  const person = await available(responsible)
  if (person) return { recipient: person, route: 'responsible', reason: null }
  const name = (await one(env, 'SELECT name FROM beam_members WHERE id = ?', responsible))?.name ?? 'The responsible owner'
  const fallback = await available(item.fallback_owner_id)
  if (fallback) return { recipient: fallback, route: 'fallback', reason: `${name} is unavailable` }
  return { recipient: await one(env, `${AVAILABLE} AND o.role = 'owner'`), route: 'owner', reason: `${name} is unavailable and ${item.fallback_owner_id ? 'the fallback owner is unavailable too' : 'no fallback owner is set'}` }
}

function message(env: Bindings, item: Row, target: Awaited<ReturnType<typeof route>>) {
  const link = `${env.AUTH_ORIGIN}/app/courses/${item.course_id}`
  const what = item.kind === 'review' ? `“${item.title}” is due for its scheduled content review (review date ${item.due_on}).` : `A source cited by “${item.title}” has a new version: “${item.source_title}” moved from version ${item.previous_number} to ${item.new_number}.`
  const escalated = target.route === 'responsible' ? '' : `\n\nThis is escalated to you as ${target.route === 'fallback' ? 'the course’s fallback owner' : 'the installation owner'}: ${target.reason}.`
  const text = `${what}${escalated}\n\nThe named reviewer or the owner records whether the training changes materially, with the next review date: ${link}`
  const html = text.split('\n\n').map(part => `<p>${part.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)}</p>`).join('')
  return { subject: `${item.kind === 'review' ? 'Content review due' : 'Source changed'}: ${item.title}`, text, html }
}

/** Opens due reviews and mails every open item; `manual` is the owner's explicit replay of held or failed mail. */
export async function runUpkeep(env: Bindings, manual = false) {
  const settings = await business(env)
  if (!settings) return []
  const today = localDate(now(), settings.timezone)
  for (const course of await all(env, "SELECT id, next_review_on FROM beam_courses WHERE retired_at IS NULL AND next_review_on <= ? AND NOT EXISTS (SELECT 1 FROM beam_content_reviews r WHERE r.course_id = beam_courses.id AND r.due_on = beam_courses.next_review_on)", today)) {
    const id = newId()
    await commit(env, [stmt(env, "INSERT OR IGNORE INTO beam_content_reviews (id, course_id, due_on, state, created_at) VALUES (?, ?, ?, 'open', ?)", id, course.id, course.next_review_on, now())],
      { actor: 'system', action: 'review.open', subject: id, detail: { course: course.id, dueOn: course.next_review_on } })
  }
  const owner = await one(env, `${AVAILABLE} AND o.role = 'owner'`)
  if (!owner) return []
  const items = await all(env, `SELECT 'review' AS kind, r.id, r.course_id, r.due_on, NULL AS source_title, NULL AS previous_number, NULL AS new_number, c.title, c.owner_id, c.reviewer_id, c.fallback_owner_id, r.created_at AS opened_at
      FROM beam_content_reviews r JOIN beam_courses c ON c.id = r.course_id WHERE r.state = 'open'
    UNION ALL SELECT 'source', n.id, n.course_id, NULL, s.title, pv.number, nv.number, c.title, c.owner_id, c.reviewer_id, c.fallback_owner_id, n.created_at
      FROM beam_source_notices n JOIN beam_courses c ON c.id = n.course_id JOIN beam_sources s ON s.id = n.source_id
      JOIN beam_source_versions pv ON pv.id = n.previous_version_id JOIN beam_source_versions nv ON nv.id = n.new_version_id WHERE n.state = 'open'
    ORDER BY opened_at`)
  const results = []
  for (const item of items) {
    const target = await route(env, item)
    const recipient = target.recipient ?? owner
    const mail = message(env, item, target)
    const outcome = await controlledExecution(env, { kind: 'upkeep', rule: RULE, event: `${item.kind}:${item.id}:${recipient.id}`, learner: recipient.id, authority: owner.id, unit: null, manual,
      input: { kind: item.kind, item: item.id, course: item.course_id, recipient: recipient.id, route: target.route, reason: target.reason } }, async artifact => {
      const open = await one(env, `SELECT 1 FROM ${item.kind === 'review' ? 'beam_content_reviews' : 'beam_source_notices'} WHERE id = ? AND state = 'open'`, item.id)
      insist(open, 'item_decided', 409)
      const sender = operatorMail(env)
      insist(sender && env.MAIL_FROM, 'mail_not_configured', 409)
      insist(recipient.email, 'no_contact_route', 409)
      const sent = await sender.send({ deliveryId: artifact, from: env.MAIL_FROM, to: [recipient.email], subject: mail.subject, text: mail.text, html: mail.html, headers: {} })
      insist(sent.status === 'accepted' || sent.status === 'development', `mail_${sent.status}`, 502)
      await commit(env, [stmt(env, 'INSERT INTO beam_upkeep_messages (id, item_kind, item_id, course_id, recipient_id, route, reason, status, provider_message_id, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', artifact, item.kind, item.id, item.course_id, recipient.id, target.route, target.reason, sent.status, sent.providerMessageId, now())],
        { actor: owner.id, action: 'upkeep.mail', subject: item.id, detail: { course: item.course_id, recipient: recipient.id, route: target.route, reason: target.reason, status: sent.status } })
      return sent.status === 'accepted' ? 'mail_accepted' : 'mail_development'
    })
    results.push({ kind: item.kind, item: item.id, course: item.course_id, recipient: recipient.id, route: target.route, outcome })
  }
  return results
}

export async function runUpkeepNow(env: Bindings, actor: Actor) {
  requireOwner(actor)
  return { results: await runUpkeep(env, true) }
}

/** A course's upkeep for its page and JSON: settings, who it reaches now, reviews, mail and recorded failures. */
export async function courseUpkeep(env: Bindings, course: Row) {
  const target = await route(env, course)
  const reviews = await all(env, 'SELECT id, due_on AS dueOn, state, note, next_review_on AS nextReviewOn, decided_by AS decidedBy, decided_at AS decidedAt, created_at AS createdAt FROM beam_content_reviews WHERE course_id = ? ORDER BY due_on DESC', course.id)
  const messages = await all(env, 'SELECT id, item_kind AS itemKind, item_id AS item, recipient_id AS recipient, route, reason, status, sent_at AS sentAt FROM beam_upkeep_messages WHERE course_id = ? ORDER BY sent_at DESC LIMIT 50', course.id)
  const failures = await all(env, "SELECT json_extract(input_json, '$.kind') AS itemKind, json_extract(input_json, '$.item') AS item, json_extract(input_json, '$.recipient') AS recipient, json_extract(input_json, '$.route') AS route, outcome, failure, updated_at AS at FROM beam_automation_executions WHERE kind = 'upkeep' AND state <> 'succeeded' AND json_extract(input_json, '$.course') = ? ORDER BY updated_at DESC", course.id)
  return { responsible: course.owner_id ?? course.reviewer_id, fallbackOwner: course.fallback_owner_id ?? null, nextReviewOn: course.next_review_on ?? null, reachesNow: target.recipient?.id ?? null, route: target.route, reason: target.reason, reviews, messages, failures }
}
