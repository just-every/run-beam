import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPortability, readArchive } from '@runeditrun/rer/modules/portability'
import { exportArchive, fileRecords } from '@runeditrun/rer/modules/portability/files'

// LIB-006: the owner defines a food-handler requirement for kitchen staff with a 30-day reminder; a learner uploads a
// photo of their card from the phone form and sees it waiting; nothing counts until the manager approves it, then
// REPORT-001 counts the learner current, labelled external. A second upload rejected with a reason tells the learner
// why; a manager's upload for the learner replaces the approved one. Thirty days before expiry the learner and the
// manager see the renewal reminder; once it lapses the learner is missing, and every certificate (rejected, replaced,
// expired) stays in the transcript and in the installation archive `rer export` writes (BEAM-16).
export async function externalCheck(f) {
  const { api, h, cookies, ids, request } = f
  const DAY = 86_400_000
  const day = offset => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)
  const photo = name => new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, ...Buffer.from(name)])], `${name}.jpg`, { type: 'image/jpeg' })
  const upload = async (role, fields) => new URL((await request('/app/do/external.upload', { role, body: { returnTo: '/app/external', ...fields }, encoding: 'multipart' })).location, h.origin)
  const kitchen = await f.team('Kitchen staff', [ids.learner])

  // Only the owner defines requirements; the manager is refused.
  assert.equal((await api('manager', 'external.requirement', { name: 'Food handler card', teams: [kitchen], reviewer: 'manager', reminderDays: 30 }, 403)).error, 'owner_required')
  assert.equal((await h.submit('external.requirement', cookies.owner, { name: 'Food handler card, renew on expiry', teams: kitchen, reviewer: 'manager', reminderDays: '30', expires: 'yes' }, '/app/external')).searchParams.get('error'), null)
  const requirement = (await api('owner', 'external')).requirements.find(item => item.name === 'Food handler card, renew on expiry').id

  // The learner's phone form opens the camera; a card photo with its dates goes up and waits for review.
  const page = await (await h.raw('/app/external', { cookie: cookies.learner })).text()
  assert.ok(page.includes('accept="image/*,application/pdf" capture="environment"') && page.includes('Food handler card, renew on expiry'))
  const card = { requirement, issuer: 'County Health Department', number: 'FH-2231', issuedOn: day(-300), expiresOn: day(60) }
  assert.equal((await upload('learner', { ...card, file: photo('card') })).searchParams.get('error'), null)
  assert.equal((await upload('learner', { ...card, file: new File(['plain words'], 'card.txt') })).searchParams.get('error'), 'certificate_file_type')
  assert.equal((await upload('learner', { ...card, expiresOn: day(-400), file: photo('card') })).searchParams.get('error'), 'expiry_before_issue')
  assert.equal((await upload('assessor', { ...card, learner: ids.learner, file: photo('card') })).searchParams.get('error'), 'forbidden')
  let mine = (await api('learner', 'external')).mine[0]
  assert.deepEqual([mine.status, mine.pending.number], ['pending', 'FH-2231'])
  assert.ok((await (await h.raw('/app/external', { cookie: cookies.learner })).text()).includes('Waiting for review'))
  let row = (await api('manager', `report?course=${requirement}`)).rows.find(item => item.learner === ids.learner)
  assert.deepEqual([row.status, row.external.pending], ['missing', true])

  // Only the named reviewer decides: not the learner, not an assessor; the manager approves and the report counts it.
  const first = mine.pending.id
  assert.equal((await api('learner', 'external.decide', { certificate: first, decision: 'approve' }, 403)).error, 'own_certificate_review_refused')
  assert.equal((await api('assessor', 'external.decide', { certificate: first, decision: 'approve' }, 403)).error, 'not_the_reviewer')
  assert.deepEqual((await api('manager', 'external')).review.map(item => item.id), [first])
  assert.equal((await h.submit('external.decide', cookies.manager, { certificate: first, decision: 'approve' }, '/app/external')).searchParams.get('error'), null)
  row = (await api('manager', `report?course=${requirement}`)).rows.find(item => item.learner === ids.learner)
  assert.deepEqual([row.status, row.method, row.certificate, row.certificateId], ['completed', 'external', 'County Health Department FH-2231', null])
  const csv = await (await h.raw(`/app/reports.csv?course=${requirement}`, { cookie: cookies.manager })).text()
  assert.ok(csv.split('\r\n').some(line => line.startsWith('learner,"Food handler card, renew on expiry",,completed,') && line.includes(',external certificate,external,')))
  assert.ok((await (await h.raw(`/app/reports?course=${requirement}`, { cookie: cookies.manager })).text()).includes('external certificate'))

  // A second upload is rejected with a reason the learner reads; the approved card still counts.
  assert.equal((await upload('learner', { ...card, number: 'FH-22?1', file: photo('blurry') })).searchParams.get('error'), null)
  const second = (await api('learner', 'external')).mine[0].pending.id
  assert.equal((await api('manager', 'external.decide', { certificate: second, decision: 'reject' }, 400)).error, 'missing_reason')
  await api('manager', 'external.decide', { certificate: second, decision: 'reject', reason: 'The photo is blurry; the number cannot be read.' })
  mine = (await api('learner', 'external')).mine[0]
  assert.deepEqual([mine.status, mine.rejected.reason], ['current', 'The photo is blurry; the number cannot be read.'])
  assert.ok((await (await h.raw('/app/learning', { cookie: cookies.learner })).text()).includes('Rejected: The photo is blurry; the number cannot be read.'))

  // The manager uploads the renewed card for the learner; approving it replaces the first.
  assert.equal((await upload('manager', { ...card, learner: ids.learner, number: 'FH-3390', issuedOn: day(-1), expiresOn: day(700), file: photo('renewed') })).searchParams.get('error'), null)
  const third = (await api('manager', 'external')).review[0]
  assert.deepEqual([third.number, third.uploadedBy], ['FH-3390', 'manager'])
  await api('manager', 'external.decide', { certificate: third.id, decision: 'approve' })
  mine = (await api('learner', 'external')).mine[0]
  assert.deepEqual([mine.current.number, mine.history.map(item => item.state)], ['FH-3390', ['approved', 'rejected', 'replaced']])
  const file = await h.raw(`/app/files/external/${third.id}`, { cookie: cookies.learner })
  assert.deepEqual([file.status, file.headers.get('content-type'), file.headers.get('content-disposition').startsWith('attachment')], [200, 'application/octet-stream', true])
  assert.equal((await h.raw(`/app/files/external/${third.id}`, { cookie: cookies.other })).status, 404)

  // Thirty days before expiry: the learner and the manager are reminded; the report shows it expiring.
  await h.db.prepare('UPDATE beam_external_certificates SET expires_on = ?1, expires_at = ?2 WHERE id = ?3').bind(day(29), Date.parse(`${day(30)}T00:00:00Z`), third.id).run()
  assert.deepEqual((await api('learner', 'external')).reminders.map(item => [item.status, item.expiresOn]), [['renewal_due', day(29)]])
  assert.deepEqual((await api('manager', 'external')).renewals.map(item => [item.learner, item.status]), [[ids.learner, 'renewal_due']])
  assert.ok((await (await h.raw('/app/learning', { cookie: cookies.learner })).text()).includes(`Renewal due: expires`))
  assert.ok((await (await h.raw('/app/external', { cookie: cookies.manager })).text()).includes('Renewals due for your people'))
  assert.equal((await api('manager', `report?course=${requirement}`)).rows.find(item => item.learner === ids.learner).status, 'expiring')

  // Lapsed: the learner is missing; the certificate stays in the transcript and the export, beside the rejected and
  // replaced ones.
  await h.db.prepare('UPDATE beam_external_certificates SET expires_on = ?1, expires_at = ?2 WHERE id = ?3').bind(day(-1), Date.parse(`${day(0)}T00:00:00Z`), third.id).run()
  row = (await api('manager', `report?course=${requirement}&status=missing`)).rows.find(item => item.learner === ids.learner)
  assert.deepEqual([row.status, row.external.lapsed], ['missing', true])
  assert.deepEqual((await api('manager', 'external')).renewals.map(item => item.status), ['missing'])
  const kinds = (await api('learner', 'transcripts/me')).entries.filter(entry => entry.kind.startsWith('external certificate')).map(entry => `${entry.kind}:${entry.record}`)
  for (const expected of [`external certificate approved:${first}`, `external certificate replaced:${first}`, `external certificate rejected:${second}`, `external certificate expired:${third.id}`]) assert.ok(kinds.includes(expected), expected)
  assert.ok((await (await h.raw(`/app/records/${ids.learner}/transcript.csv`, { cookie: cookies.manager })).text()).includes('The photo is blurry'))

  const directory = await mkdtemp(join(tmpdir(), 'beam-export-'))
  try {
    const service = await createPortability({ db: h.db, buckets: { files: h.files }, policy: { product: 'learning/beam', buckets: { files: { prefix: 'sha256/' } }, requiredConfiguration: [] } })
    await exportArchive(service, join(directory, 'installation.rer'))
    const items = []
    for await (const record of fileRecords(join(directory, 'installation.rer'), readArchive)) if (record.kind === 'part') items.push(...record.items)
    const exported = items.filter(item => item.kind === 'row' && item.table === 'beam_external_certificates').map(item => item.row)
    assert.deepEqual(new Map(exported.map(item => [item.id, item.state])), new Map([[first, 'replaced'], [second, 'rejected'], [third.id, 'approved']]))
  } finally { await rm(directory, { recursive: true, force: true }) }
}
