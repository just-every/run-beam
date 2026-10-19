import assert from 'node:assert/strict'
import { file } from './harness.mjs'
import { fixture } from './regression-fixture.mjs'

// AUTHOR-006: a course's catalog manager sets its fallback owner and next review date; the scheduler opens a review once
// the date comes (none before) and mails it to the responsible owner, escalates to the fallback owner and then the
// installation owner when they are unavailable, records a provider refusal without retrying it by itself, and the
// owner's explicit run replays it once. The named reviewer records a no-change decision with the next review date;
// separately a replaced cited source reaches the owner by mail and its no-change decision sets the next date too.
export async function upkeepCheck() {
  // The scheduler and the AUTO-008 ledger are installation-wide; keep them to this clause.
  const f = await fixture()
  try { await upkeep(f) } finally { await f.h.close() }
}

async function upkeep(f) {
  const { api, h, ids, cookies } = f
  const day = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10) // the business is on UTC
  const tick = async () => assert.equal((await h.scheduled()).outcome, 'ok')
  const sent = () => h.mails.filter(mail => /^(Content review due|Source changed): /.test(mail.subject))
  const to = (mail, email) => mail.to.some(address => address.includes(email))
  const upkeepOf = async id => (await api('owner', `courses/${id}`)).upkeep

  const source = await api('author', 'source.create', { title: 'Cooler log procedure', licence: 'owned', licenceEvidence: 'Written by our kitchen lead', reviewer: ids.reviewer, provenance: 'Kitchen binder', file: file('cooler.txt', 'Log the cooler temperature at opening.') })
  const course = await api('author', 'course.create', { title: 'Walk-in cooler checks', reviewer: ids.reviewer })
  const draftVersion = (await api('author', 'course.lesson', { course: course.id, draftVersion: course.draftVersion, title: 'Cooler', body: 'Log the cooler temperature.', sources: [source.versionId] })).draftVersion
  await f.publish((await api('author', 'course.submit', { course: course.id, draftVersion })).id)
  await api('owner', 'course.catalog', { course: course.id, owner: ids.author })

  // Only whoever manages the course's catalog sets upkeep; the next review date must come after today.
  await api('author', 'course.upkeep', { course: course.id, fallbackOwner: ids.manager, nextReviewOn: day(1) }, 403)
  assert.equal((await api('owner', 'course.upkeep', { course: course.id, fallbackOwner: ids.manager, nextReviewOn: day(0) }, 400)).error, 'review_date_not_after_today')
  assert.equal((await h.submit('course.upkeep', cookies.owner, { course: course.id, fallbackOwner: ids.manager, nextReviewOn: day(1) }, `/app/courses/${course.id}`)).searchParams.get('error'), null)
  let upkeep = await upkeepOf(course.id)
  assert.deepEqual([upkeep.responsible, upkeep.fallbackOwner, upkeep.nextReviewOn, upkeep.reachesNow, upkeep.route], [ids.author, ids.manager, day(1), ids.author, 'responsible'])

  // Before the date the scheduler opens nothing; once the date comes it opens one review and mails the owner once.
  await tick()
  assert.deepEqual([(await upkeepOf(course.id)).reviews, sent()], [[], []])
  await h.db.prepare('UPDATE beam_courses SET next_review_on = ? WHERE id = ?').bind(day(0), course.id).run()
  await tick()
  await tick()
  upkeep = await upkeepOf(course.id)
  assert.deepEqual(upkeep.reviews.map(review => [review.dueOn, review.state]), [[day(0), 'open']])
  assert.equal(sent().length, 1)
  assert.ok(to(sent()[0], 'author@example.test') && sent()[0].subject.includes('Walk-in cooler checks') && sent()[0].text.includes(`/app/courses/${course.id}`))
  assert.deepEqual(upkeep.messages.map(message => [message.recipient, message.route, message.status]), [[ids.author, 'responsible', 'accepted']])
  assert.ok((await api('reviewer', 'queues')).contentReviews.some(row => row.course === course.id && row.dueOn === day(0)))

  // The owner removes the responsible owner's access: the open review escalates to the fallback owner, once.
  await api('owner', 'person.access', { member: ids.author, status: 'inactive' })
  await tick()
  await tick()
  assert.equal(sent().length, 2)
  assert.ok(to(sent()[1], 'manager@example.test'))
  upkeep = await upkeepOf(course.id)
  assert.deepEqual([upkeep.reachesNow, upkeep.route, upkeep.messages[0].route, upkeep.messages[0].recipient], [ids.manager, 'fallback', 'fallback', ids.manager])
  assert.match(upkeep.messages[0].reason, /unavailable/)

  // With no fallback owner it escalates to the installation owner. The provider refuses that mail: the failure is
  // recorded and shown, the next scheduled run does not retry it, and the owner's explicit run sends it once.
  await api('owner', 'course.upkeep', { course: course.id, fallbackOwner: '', nextReviewOn: day(1) })
  await h.db.prepare('UPDATE beam_courses SET next_review_on = ? WHERE id = ?').bind(day(0), course.id).run()
  h.edge.refuse = true
  await tick()
  h.edge.refuse = false
  upkeep = await upkeepOf(course.id)
  assert.equal(upkeep.reviews.length, 1, 'the same due date opens no second review')
  assert.deepEqual(upkeep.failures.map(failure => [failure.recipient, failure.route, failure.outcome]), [[ids.owner, 'owner', 'failed']])
  assert.match(upkeep.failures[0].failure, /^mail_rejected: /)
  assert.ok((await (await h.raw(`/app/courses/${course.id}`, { cookie: cookies.owner })).text()).includes('mail_rejected'))
  await tick()
  assert.equal(sent().length, 2, 'a recorded failure is never retried automatically')
  await api('manager', 'upkeep.run', {}, 403)
  const replay = await api('owner', 'upkeep.run', {})
  assert.deepEqual(replay.results.map(result => [result.recipient, result.route, result.outcome]), [[ids.owner, 'owner', 'mail_accepted']])
  assert.equal((await api('owner', 'upkeep.run', {})).results[0].outcome, 'already_ran')
  assert.equal(sent().length, 3)
  assert.ok(to(sent()[2], 'owner@example.test'))
  assert.deepEqual((await upkeepOf(course.id)).failures, [])

  // Only the named reviewer (or the owner) decides; the decision keeps its note and the next review date.
  const review = upkeep.reviews[0]
  await api('manager', 'review.decide', { review: review.id, decision: 'no_material_change', note: 'x', nextReviewOn: day(180) }, 403)
  assert.equal((await api('reviewer', 'review.decide', { review: review.id, decision: 'no_material_change', note: 'Still accurate.', nextReviewOn: day(0) }, 400)).error, 'review_date_not_after_today')
  await api('reviewer', 'review.decide', { review: review.id, decision: 'no_material_change', note: 'Still accurate.', nextReviewOn: day(180) })
  await api('reviewer', 'review.decide', { review: review.id, decision: 'draft_updated', note: 'Again', nextReviewOn: day(180) }, 409)
  upkeep = await upkeepOf(course.id)
  assert.deepEqual(upkeep.reviews.map(row => [row.state, row.note, row.nextReviewOn, row.decidedBy]), [['no_material_change', 'Still accurate.', day(180), ids.reviewer]])
  assert.equal(upkeep.nextReviewOn, day(180))
  assert.ok(!(await api('reviewer', 'queues')).contentReviews.length)
  await tick()
  assert.equal(sent().length, 3)

  // Separately, replacing the cited source notifies the (restored) responsible owner by mail, and the named reviewer's
  // no-change decision requires and keeps the next review date.
  await api('owner', 'person.access', { member: ids.author, status: 'active' })
  cookies.author = await h.signIn('author@example.test')
  const version = await api('author', 'source.version', { source: source.id, provenance: 'Cooler model replaced', file: file('cooler.txt', 'Log the cooler temperature at opening and closing.') })
  assert.deepEqual(version.flaggedCourses, [course.id])
  await tick()
  await tick()
  assert.equal(sent().length, 4)
  assert.ok(to(sent()[3], 'author@example.test') && sent()[3].subject.startsWith('Source changed: '))
  const notice = (await api('reviewer', 'queues')).notices.find(row => row.course === course.id)
  assert.equal((await api('reviewer', 'notice.decide', { notice: notice.id, decision: 'no_material_change', note: 'Same steps.' }, 400)).error, 'missing_nextReviewOn')
  await api('reviewer', 'notice.decide', { notice: notice.id, decision: 'no_material_change', note: 'Same steps.', nextReviewOn: day(365) })
  const detail = await api('owner', `courses/${course.id}`)
  assert.deepEqual(detail.notices.filter(row => row.id === notice.id).map(row => [row.state, row.note, row.next_review_on]), [['no_material_change', 'Same steps.', day(365)]])
  assert.equal(detail.upkeep.nextReviewOn, day(365))
  await tick()
  assert.equal(sent().length, 4)
}
