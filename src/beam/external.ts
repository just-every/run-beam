// LIB-006: certificates people earn outside Beam (food-handler cards, forklift, CPR, OSHA 10/30 cards). The owner
// defines a requirement for teams and AUTO-001 audiences (role, location and other directory rules), names its reviewer (the person's managers, one named assessor, or the learning
// administrators of the person's units) and how many days before expiry to remind. A learner, or their manager for
// them, uploads the certificate with its issuer, number, dates and a photo or PDF, kept as verified
// inert bytes. Nothing counts before the reviewer approves it, Beam issues no certificate of its own for it, and an
// approval replaces the person's earlier approved certificate for that requirement. An approved certificate is current
// through the end of its expiry date in the business time zone; from `reminder_days` before that date the person and
// their managers see an in-app renewal reminder, and once it lapses the person is missing. Every upload, decision,
// replacement and expiry stays in the person's transcript (transcript.ts) and in the installation archive.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { BeamError, all, commit, insist, newId, now, one, stmt, type Row } from './core'
import { audienceMembers } from './audiences'
import { serve, store } from './files'
import type { Input } from './input'
import { requireBusiness } from './people'
import { manages } from './scope'
import { DAY, addDays, localDate, zonedInstant } from './time'

export interface Requirement { id: string; name: string; teams: string[]; audiences: string[]; reviewerKind: 'manager' | 'assessor' | 'administrator'; reviewer: string | null; reviewerName: string | null; reminderDays: number; expires: boolean }
/** One person's standing on one requirement: current (approved, unexpired), renewal_due (current, inside the reminder
 * window), pending (no current certificate, one waiting for review) or missing. */
export type Standing = 'current' | 'renewal_due' | 'pending' | 'missing'
const REVIEWERS = ['manager', 'administrator'] as const
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']

export async function requirements(env: Bindings): Promise<Requirement[]> {
  return (await all(env, 'SELECT q.*, m.name AS reviewer_name FROM beam_external_requirements q LEFT JOIN beam_members m ON m.id = q.reviewer_id ORDER BY q.name'))
    .map(row => ({ id: row.id, name: row.name, teams: JSON.parse(row.teams), audiences: JSON.parse(row.audiences), reviewerKind: row.reviewer_kind, reviewer: row.reviewer_id, reviewerName: row.reviewer_name, reminderDays: row.reminder_days, expires: row.expires === 1 }))
}

async function requirement(env: Bindings, id: string) {
  const found = (await requirements(env)).find(item => item.id === id)
  insist(found, 'requirement_not_found', 404)
  return found
}

/** The owner defines a requirement: who it applies to (teams and audiences), who reviews it and when to remind before expiry. */
export async function saveRequirement(env: Bindings, actor: Actor, input: Input) {
  insist(actor.owner, 'owner_required', 403)
  const name = input.text('name', { max: 120 }), teams = [...new Set(input.list('teams'))], audiences = [...new Set(input.list('audiences'))]
  insist(teams.length + audiences.length > 0, 'teams_required')
  for (const team of teams) insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ?', team), 'team_not_found', 404)
  for (const audience of audiences) insist(await one(env, 'SELECT 1 FROM beam_audiences WHERE id = ?', audience), 'audience_not_found', 404)
  // The reviewer is "manager", "administrator", or the id of a person who holds the assessor role.
  const reviewer = input.text('reviewer', { max: 100 })
  const kind = (REVIEWERS as readonly string[]).includes(reviewer) ? reviewer : 'assessor'
  if (kind === 'assessor') insist(await one(env, "SELECT 1 FROM beam_member_roles WHERE member_id = ? AND role = 'assessor'", reviewer), 'reviewer_not_assessor')
  const reminderDays = input.integer('reminderDays', { min: 1, max: 365 })!
  const expires = (input.text('expires', { optional: true, max: 3 }) || 'yes') !== 'no'
  insist(!await one(env, 'SELECT 1 FROM beam_external_requirements WHERE name = ?', name), 'requirement_exists', 409)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_external_requirements (id, name, teams, audiences, reviewer_kind, reviewer_id, reminder_days, expires, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, name, JSON.stringify(teams), JSON.stringify(audiences), kind, kind === 'assessor' ? reviewer : null, reminderDays, expires ? 1 : 0, actor.id, now())], { actor, action: 'external.requirement', subject: id, detail: { name, teams, audiences, reviewer: kind === 'assessor' ? reviewer : kind, reminderDays, expires } })
  return { id }
}

const teamsOf = async (env: Bindings, learner: string) => (await all<{ team_id: string; unit_id: string | null }>(env, 'SELECT tm.team_id, t.unit_id FROM beam_team_members tm JOIN beam_teams t ON t.id = tm.team_id WHERE tm.member_id = ?', learner))
/** The audiences (AUTO-001) a person is in now. */
const audiencesOf = async (env: Bindings, learner: string) => new Set((await all<{ audience_id: string }>(env, 'SELECT audience_id FROM beam_audience_members WHERE member_id = ? AND left_at IS NULL', learner)).map(row => row.audience_id))
const applies = async (env: Bindings, item: Requirement, learner: string) => (await teamsOf(env, learner)).some(row => item.teams.includes(row.team_id)) || [...await audiencesOf(env, learner)].some(id => item.audiences.includes(id))

/** The reviewer the requirement names; the owner reviews for anyone. Nobody reviews their own certificate. */
export async function reviews(env: Bindings, actor: Actor, item: Requirement, learner: string) {
  if (learner === actor.id || actor.agent) return false
  if (actor.owner) return true
  const teams = await teamsOf(env, learner)
  if (item.reviewerKind === 'manager') return teams.some(row => actor.managedTeams.includes(row.team_id))
  if (item.reviewerKind === 'administrator') return teams.some(row => row.unit_id !== null && actor.adminUnits.includes(row.unit_id))
  return item.reviewer === actor.id && actor.roles.has('assessor')
}

/** A learner uploads their own certificate; one of their managers uploads one for them. */
export async function uploadCertificate(env: Bindings, actor: Actor, input: Input) {
  insist(!actor.agent, 'forbidden', 403)
  const item = await requirement(env, input.text('requirement', { max: 100 }))
  const learner = input.text('learner', { optional: true, max: 100 }) || actor.id
  // The person's own managers upload for them (the owner for anyone); nobody else does.
  if (learner !== actor.id) insist(actor.owner || (await teamsOf(env, learner)).some(row => actor.managedTeams.includes(row.team_id)), 'forbidden', 403)
  insist(await applies(env, item, learner), 'requirement_does_not_apply', 403)
  const zone = (await requireBusiness(env)).timezone, today = localDate(now(), zone)
  const issuer = input.text('issuer', { max: 160 }), number = input.text('number', { max: 80 })
  const issuedOn = input.text('issuedOn', { max: 10 })
  zonedInstant(issuedOn, '00:00', zone)
  insist(issuedOn <= today, 'issued_in_future')
  const expiresOn = input.text('expiresOn', { optional: true, max: 10 }) || null
  insist(!item.expires || expiresOn, 'expiry_required')
  // Current through the end of the expiry date in the business time zone: it lapses at the next local midnight.
  const expiresAt = expiresOn ? zonedInstant(addDays(expiresOn, 1), '00:00', zone) : null
  insist(!expiresOn || expiresOn > issuedOn, 'expiry_before_issue')
  const file = await input.file('file')
  const stored = await store(env, file!)
  insist(FILE_TYPES.includes(stored.mediaType), 'certificate_file_type')
  const id = newId(), attachment = newId()
  await commit(env, [
    stmt(env, 'INSERT INTO beam_attachments (id, filename, media_type, size, sha256, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)', attachment, stored.filename, stored.mediaType, stored.size, stored.sha256, actor.id, now()),
    stmt(env, "INSERT INTO beam_external_certificates (id, requirement_id, learner_id, issuer, number, issued_on, expires_on, expires_at, attachment_id, uploaded_by, uploaded_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
      id, item.id, learner, issuer, number, issuedOn, expiresOn, expiresAt, attachment, actor.id, now()),
  ], { actor, action: 'external.upload', subject: id, detail: { requirement: item.id, learner, issuer, number, issuedOn, expiresOn, sha256: stored.sha256 } })
  return { id, state: 'pending' }
}

/** The named reviewer approves a waiting certificate, or rejects it with a reason the person sees. */
export async function decideCertificate(env: Bindings, actor: Actor, input: Input) {
  const certificate = await one(env, 'SELECT * FROM beam_external_certificates WHERE id = ?', input.text('certificate', { max: 100 }))
  insist(certificate, 'certificate_not_found', 404)
  const item = await requirement(env, certificate.requirement_id)
  insist(await reviews(env, actor, item, certificate.learner_id), certificate.learner_id === actor.id ? 'own_certificate_review_refused' : 'not_the_reviewer', 403)
  insist(certificate.state === 'pending', 'certificate_already_decided', 409)
  const decision = input.text('decision', { max: 10 })
  insist(decision === 'approve' || decision === 'reject', 'invalid_decision')
  const reason = input.text('reason', { optional: decision === 'approve', max: 500 }) || null
  const at = now()
  if (decision === 'reject') {
    await commit(env, [stmt(env, "UPDATE beam_external_certificates SET state = 'rejected', decided_by = ?, decided_at = ?, reason = ? WHERE id = ? AND state = 'pending'", actor.id, at, reason, certificate.id)],
      { actor, action: 'external.reject', subject: certificate.id, detail: { learner: certificate.learner_id, requirement: item.id, reason } })
    return { id: certificate.id, state: 'rejected' }
  }
  insist(!certificate.expires_at || certificate.expires_at > at, 'certificate_expired', 409)
  await commit(env, [
    stmt(env, "UPDATE beam_external_certificates SET state = 'replaced', replaced_by = ?, replaced_at = ? WHERE learner_id = ? AND requirement_id = ? AND state = 'approved'", certificate.id, at, certificate.learner_id, item.id),
    stmt(env, "UPDATE beam_external_certificates SET state = 'approved', decided_by = ?, decided_at = ?, reason = ? WHERE id = ? AND state = 'pending'", actor.id, at, reason, certificate.id),
  ], { actor, action: 'external.approve', subject: certificate.id, detail: { learner: certificate.learner_id, requirement: item.id, expiresOn: certificate.expires_on } })
  return { id: certificate.id, state: 'approved' }
}

const CERTIFICATE_COLUMNS = `c.id, c.requirement_id AS requirement, c.learner_id AS learner, m.name AS learnerName, c.issuer, c.number, c.issued_on AS issuedOn, c.expires_on AS expiresOn, c.expires_at AS expiresAt,
  c.state, c.reason, c.uploaded_at AS uploadedAt, c.decided_at AS decidedAt, c.replaced_at AS replacedAt, (SELECT name FROM beam_members WHERE id = c.uploaded_by) AS uploadedBy, (SELECT name FROM beam_members WHERE id = c.decided_by) AS decidedBy`

/** Every certificate of these people (all when null), oldest first. */
const certificatesOf = (env: Bindings, learners: string[] | null) => all(env, `SELECT ${CERTIFICATE_COLUMNS} FROM beam_external_certificates c JOIN beam_members m ON m.id = c.learner_id
  WHERE (? IS NULL OR c.learner_id IN (SELECT value FROM json_each(?))) ORDER BY c.uploaded_at, c.rowid`, learners && JSON.stringify(learners), learners && JSON.stringify(learners))

/** One person's standing on one requirement at `at`, from their certificates for it (oldest first). */
export function standing(item: Requirement, certificates: Row[], at: number, zone: string) {
  const mine = certificates.filter(row => row.requirement === item.id)
  const approved = mine.filter(row => row.state === 'approved').at(-1) ?? null
  const current = approved && (!approved.expiresAt || approved.expiresAt > at) ? approved : null
  const pending = mine.filter(row => row.state === 'pending').at(-1) ?? null
  const rejected = mine.filter(row => row.state === 'rejected').at(-1) ?? null
  const lapsed = approved && !current ? approved : null
  // The reminder starts at local midnight `reminderDays` days before the lapse (the midnight after the expiry date).
  const renewFrom = current?.expiresOn ? zonedInstant(addDays(current.expiresOn, 1 - item.reminderDays), '00:00', zone) : null
  const status: Standing = current ? (renewFrom !== null && at >= renewFrom ? 'renewal_due' : 'current') : pending ? 'pending' : 'missing'
  return { status, current, pending, rejected: rejected && (!approved || rejected.uploadedAt > approved.uploadedAt) ? rejected : null, lapsed }
}

/** Everyone a requirement applies to whom this person may see (null = everyone), with each standing. */
async function audience(env: Bindings, items: Requirement[], visible: (learner: string) => boolean) {
  const members = await all<{ team_id: string; member_id: string; name: string }>(env, 'SELECT tm.team_id, tm.member_id, m.name FROM beam_team_members tm JOIN beam_members m ON m.id = tm.member_id ORDER BY m.name')
  const grouped = await audienceMembers(env, [...new Set(items.flatMap(item => item.audiences))])
  const pairs = new Map<string, { requirement: Requirement; learner: string; learnerName: string }>()
  for (const item of items) {
    for (const row of members) if (item.teams.includes(row.team_id) && visible(row.member_id)) pairs.set(`${item.id}:${row.member_id}`, { requirement: item, learner: row.member_id, learnerName: row.name })
    for (const row of grouped) if (item.audiences.includes(row.audience) && visible(row.member)) pairs.set(`${item.id}:${row.member}`, { requirement: item, learner: row.member, learnerName: row.name })
  }
  return [...pairs.values()].sort((a, b) => a.learnerName.localeCompare(b.learnerName))
}

/** LIB-006 rows for REPORT-001: one per person a requirement applies to, labelled external. Current counts as completed
 * (expiring within 30 days, as for courses); a pending, rejected or lapsed certificate leaves the person missing. */
export async function externalReportRows(env: Bindings, scope: string | null, filters: { course: string; team: string }, at: number) {
  const items = (await requirements(env)).filter(item => !filters.course || item.id === filters.course)
  if (!items.length) return []
  const inScope = scope === null ? null : new Set(JSON.parse(scope) as string[])
  const team = filters.team ? new Set((await all<{ member_id: string }>(env, 'SELECT member_id FROM beam_team_members WHERE team_id = ?', filters.team)).map(row => row.member_id)) : null
  const people = await audience(env, items, learner => (!inScope || inScope.has(learner)) && (!team || team.has(learner)))
  const certificates = await certificatesOf(env, [...new Set(people.map(row => row.learner))]), zone = (await requireBusiness(env)).timezone
  return people.map(({ requirement: item, learner, learnerName }) => {
    const state = standing(item, certificates.filter(row => row.learner === learner), at, zone), current = state.current
    const status = current ? (current.expiresAt && current.expiresAt <= at + 30 * DAY ? 'expiring' : 'completed') : 'missing'
    return { assignment: null, learner, learnerName, course: item.id, courseTitle: item.name, revisionNumber: null, revision: null, assignmentStatus: 'external', dueAt: null, timezone: null,
      lessonsDone: 0, lessonsTotal: 0, quizAttempts: 0, bestPercent: null, quizPassed: null, practical: null, extension: null, exception: null, originalDueAt: null,
      completion: current?.id ?? null, method: current ? 'external' : null, completedAt: current?.decidedAt ?? null, expiresAt: current?.expiresAt ?? null, certificate: current ? `${current.issuer} ${current.number}` : null, certificateId: null,
      external: { pending: !!state.pending, lapsed: !!state.lapsed, rejected: state.rejected?.reason ?? null }, status } as Row
  }).sort((a, b) => a.learnerName.localeCompare(b.learnerName) || a.courseTitle.localeCompare(b.courseTitle))
}

/** The external certificates page and JSON (GET /api/beam/external): the person's own requirements, the certificates
 * waiting for their review, renewal reminders for the people they manage, and the owner's requirements. */
export async function externalView(env: Bindings, actor: Actor) {
  const at = now(), items = await requirements(env), zone = (await requireBusiness(env)).timezone
  const own = new Set((await teamsOf(env, actor.id)).map(row => row.team_id)), ownAudiences = await audiencesOf(env, actor.id)
  const mineItems = items.filter(item => item.teams.some(team => own.has(team)) || item.audiences.some(id => ownAudiences.has(id)))
  const myCertificates = await certificatesOf(env, [actor.id])
  const mine = mineItems.map(item => ({ requirement: item, ...standing(item, myCertificates, at, zone), history: myCertificates.filter(row => row.requirement === item.id).reverse() }))
  // People whose standing this person may read: managers and administrators for their scope (or a custom role with
  // certificates or reports), the owner for everyone, and the reviewer of a requirement for the people it reviews.
  const people = actor.agent ? [] : await audience(env, items, learner => learner !== actor.id && manages(actor, learner, 'certificates', 'reports'))
  const reviewable = actor.agent ? [] : await Promise.all((await all(env, `SELECT ${CERTIFICATE_COLUMNS} FROM beam_external_certificates c JOIN beam_members m ON m.id = c.learner_id WHERE c.state = 'pending' ORDER BY c.uploaded_at`))
    .map(async row => (await reviews(env, actor, items.find(item => item.id === row.requirement)!, row.learner)) ? row : null))
  const theirs = await certificatesOf(env, [...new Set(people.map(row => row.learner))])
  const standings = people.map(row => ({ learner: row.learner, learnerName: row.learnerName, requirement: row.requirement.id, requirementName: row.requirement.name, ...standing(row.requirement, theirs.filter(item => item.learner === row.learner), at, zone) }))
  const named = (row: Row): Row => ({ ...row, requirementName: items.find(item => item.id === row.requirement)?.name })
  return {
    asOf: at, zone,
    requirements: actor.owner ? items : mineItems,
    mine,
    reminders: mine.filter(row => row.status === 'renewal_due' || (row.status !== 'current' && row.lapsed)).map(row => ({ requirement: row.requirement.id, name: row.requirement.name, status: row.status, expiresAt: (row.current ?? row.lapsed)!.expiresAt, expiresOn: (row.current ?? row.lapsed)!.expiresOn, renewalWaiting: !!row.pending })),
    review: reviewable.filter(Boolean).map(row => named(row!)),
    people: standings,
    renewals: standings.filter(row => row.status === 'renewal_due' || (row.status !== 'current' && row.lapsed)).map(row => ({ learner: row.learner, learnerName: row.learnerName, requirement: row.requirement, name: row.requirementName, status: row.status, expiresOn: (row.current ?? row.lapsed)!.expiresOn, renewalWaiting: !!row.pending })),
  }
}

/** Transcript entries for one person (REPORT-003): every upload, decision, replacement and expiry. */
export async function externalTranscript(env: Bindings, memberId: string) {
  const at = now(), items = await requirements(env)
  const name = (id: string) => items.find(item => item.id === id)?.name ?? ''
  return (await certificatesOf(env, [memberId])).flatMap(row => {
    const label = `${row.issuer} ${row.number}, issued ${row.issuedOn}${row.expiresOn ? `, expires ${row.expiresOn}` : ''}; external, no Beam certificate`
    return [
      { at: row.uploadedAt, kind: 'external certificate uploaded', course: name(row.requirement), revision: null, detail: label, by: row.uploadedBy ?? '', record: row.id },
      ...(row.state !== 'pending' ? [{ at: row.decidedAt, kind: row.state === 'rejected' ? 'external certificate rejected' : 'external certificate approved', course: name(row.requirement), revision: null, detail: row.state === 'rejected' ? `${label}; reason: ${row.reason}` : label, by: row.decidedBy ?? '', record: row.id }] : []),
      ...(row.state === 'replaced' ? [{ at: row.replacedAt, kind: 'external certificate replaced', course: name(row.requirement), revision: null, detail: `${label}; replaced by a newer approved certificate`, by: '', record: row.id }] : []),
      ...(row.state !== 'rejected' && row.state !== 'pending' && row.expiresAt && row.expiresAt <= at ? [{ at: row.expiresAt, kind: 'external certificate expired', course: name(row.requirement), revision: null, detail: label, by: '', record: row.id }] : []),
    ]
  })
}

/** The certificate's file, as a download of inert bytes: for the person, the reviewer, and whoever reads their record. */
export async function externalFile(env: Bindings, actor: Actor, id: string) {
  const row = await one(env, 'SELECT c.learner_id, c.requirement_id, a.filename, a.media_type AS mediaType, a.size, a.sha256 FROM beam_external_certificates c JOIN beam_attachments a ON a.id = c.attachment_id WHERE c.id = ?', id)
  if (!row) throw new BeamError('not_found', 404)
  const allowed = row.learner_id === actor.id || manages(actor, row.learner_id, 'certificates', 'people') || await reviews(env, actor, await requirement(env, row.requirement_id), row.learner_id)
  if (!allowed) throw new BeamError('not_found', 404)
  return serve(env, { filename: row.filename, mediaType: row.mediaType, size: row.size, sha256: row.sha256 }, { download: true })
}
