import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'

// OPS-009: a US multi-state employer sets up on US time with US zones first, reads provider costs in USD, selects
// contractors through a reviewed audience on its own worker-type field, gets daylight-saving-correct deadlines in each
// zone, and no learning action writes worker type, employment, location or any pay field.
export async function usEmployerCheck() {
  const f = await fixture()
  try { await us(f) } finally { await f.h.close() }
}

async function us(f) {
  const { api, h, ids, cookies } = f
  const clock = (instant, zone) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant)
  await api('owner', 'business.configure', { name: 'Lone Star Kitchens', timezone: 'America/New_York' })
  const settings = await (await h.raw('/app/business', { cookie: cookies.owner })).text()
  assert.ok(settings.indexOf('"America/Los_Angeles"') > 0 && settings.indexOf('"America/Los_Angeles"') < settings.indexOf('"Europe/London"'), 'US time zones come first')

  // Costs are in USD: nothing spent through Beam, a zero automation ceiling, and mail billed to the employer's account.
  const costs = await api('owner', 'costs')
  assert.deepEqual([costs.currency, costs.spentCents, costs.ceilingCents, costs.providers], ['USD', 0, 0, [{ kind: 'mail', provider: 'resend', billing: 'employer_account', chargedByBeamCents: 0 }]])
  await api('manager', 'costs', undefined, 403)
  assert.ok(settings.includes('USD 0.00'))

  // The employer's own worker-type field; a W-2 cook in Texas and a 1099 contractor in California.
  await api('owner', 'person.field', { label: 'Worker type' })
  const worker = (await api('owner', 'directory')).fields.find(item => item.label === 'Worker type').id
  await api('owner', 'person.directory', { member: ids.learner, location: 'Austin, TX', timeZone: 'America/Chicago', [`custom_${worker}`]: 'W-2' })
  await api('owner', 'person.directory', { member: ids.assessor, location: 'Fresno, CA', timeZone: 'America/Los_Angeles', [`custom_${worker}`]: '1099' })
  const directory = async () => Promise.all([ids.learner, ids.assessor].map(async id => (await api('owner', `directory/${id}`)).person))
  const before = await directory()
  assert.ok(before.every(person => !Object.keys(person).some(key => /pay|wage|salary|compensation|classification|eligib/i.test(key))), 'Beam keeps no pay or eligibility fields')
  const directoryEdits = async () => (await api('owner', 'audit?q=person.directory')).events.length

  // Contractors are selected only through a reviewed audience: it acts only after its write-free preview.
  const safety = await f.course('Contractor site safety')
  await api('owner', 'audience.save', { name: 'Contractors', [`custom_${worker}`]: ['1099'], course: safety.id, dueDays: 14 })
  const contractors = (await api('owner', 'audiences')).audiences.find(item => item.name === 'Contractors').id
  assert.equal((await api('owner', 'audience.state', { audience: contractors, state: 'active' }, 409)).error, 'preview_required')
  assert.deepEqual((await api('owner', 'audience.preview', { audience: contractors })).joins.map(item => item.member), [ids.assessor])
  const edits = await directoryEdits()
  assert.deepEqual((await api('owner', 'audience.state', { audience: contractors, state: 'active' })).sync.joined.map(item => item.member), [ids.assessor])
  const open = async learner => (await api('owner', `records/${learner}`)).assignments.filter(row => row.status === 'open')
  const [assigned] = (await open(ids.assessor)).filter(row => row.course === safety.id)
  assert.deepEqual([assigned.timezone, clock(assigned.dueAt, 'America/New_York')], ['America/New_York', '17:00'])
  assert.ok(!(await open(ids.learner)).some(row => row.course === safety.id), 'the W-2 cook is not selected')

  // Deadlines follow daylight saving in the contractor's zone: 17:00 PST before 14 March 2027, 17:00 PDT after.
  const ladders = await f.course('Ladder safety'), heat = await f.course('Heat illness prevention')
  await api('manager', 'assignment.create', { course: ladders.id, learners: [ids.learner], dueDate: '2027-03-12', dueTime: '17:00', timezone: 'America/Chicago' })
  await api('owner', 'assignment.create', { course: ladders.id, learners: [ids.assessor], dueDate: '2027-03-12', dueTime: '17:00', timezone: 'America/Los_Angeles' })
  await api('owner', 'assignment.create', { course: heat.id, learners: [ids.assessor], dueDate: '2027-03-15', dueTime: '17:00', timezone: 'America/Los_Angeles' })
  const due = async (learner, course) => (await open(learner)).find(row => row.course === course).dueAt
  assert.deepEqual([await due(ids.assessor, ladders.id), await due(ids.assessor, heat.id), await due(ids.learner, ladders.id)], [Date.UTC(2027, 2, 13, 1), Date.UTC(2027, 2, 16, 0), Date.UTC(2027, 2, 12, 23)])

  // Learning, completion and resynchronization never touch worker type, employment, location or time zone.
  for (const lesson of (await api('assessor', `assignments/${assigned.id}`)).lessons) await api('assessor', 'lesson.complete', { assignment: assigned.id, lesson: lesson.id })
  assert.ok((await api('owner', `records/${ids.assessor}`)).completions.some(row => row.course === safety.id))
  await api('owner', 'audience.sync', { audience: contractors })
  assert.deepEqual(await directory(), before)
  assert.equal(await directoryEdits(), edits)
}
