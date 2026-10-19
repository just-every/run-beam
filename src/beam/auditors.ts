// ORG-005, auditor half: the owner shares a cohort's training evidence with a
// read-only auditor: the completions of the chosen teams' people within a
// period, their certificates and evidence files, until the grant's end. Every
// read checks the grant on the request, and each file is checked on its own
// against the completions the auditor may see. An auditor holds no role, so
// every write door refuses them.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { requireBusiness } from './people'
import { addDays, zonedInstant } from './time'
import { ACTIVE, expiry } from './units'

export async function grantAuditor(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const member = input.text('member')
  insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', member), 'person_not_found', 404)
  insist(member !== actor.id, 'owner_roles_fixed')
  const teams = [...new Set(input.list('teams'))]
  insist(teams.length > 0, 'teams_required')
  for (const team of teams) insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ?', team), 'team_not_found', 404)
  const zone = (await requireBusiness(env)).timezone
  const from = zonedInstant(input.text('periodFrom'), '00:00', zone), to = zonedInstant(addDays(input.text('periodTo'), 1), '00:00', zone)
  insist(from < to, 'period_ends_before_it_starts')
  const expiresAt = await expiry(env, input)
  insist(expiresAt, 'auditor_end_required')
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_auditor_grants (id, member_id, teams, period_from, period_to, expires_at, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, member, JSON.stringify(teams), from, to, expiresAt, actor.id, now())],
    { actor: actor.id, action: 'auditor.grant', subject: id, detail: { member, teams, from, to, expiresAt } })
  return { id, member, teams, periodFrom: from, periodTo: to, expiresAt }
}

export async function revokeAuditor(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const id = input.text('grant'), at = now()
  const result = await env.DB.batch([
    stmt(env, `UPDATE beam_auditor_grants SET revoked_by = ?, revoked_at = ? WHERE id = ? AND ${ACTIVE}`, actor.id, at, id, at),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', at, actor.id, 'auditor.revoke', id, '{}'),
  ])
  insist(result[0].meta.changes === 1, 'grant_not_active', 404)
  return { id, revokedAt: at }
}

/** SQL: completions an active auditor grant of the bound member shares (binds: member, now). */
const SHARED = `SELECT c.id FROM beam_completions c JOIN beam_auditor_grants g ON g.member_id = ? AND g.revoked_at IS NULL AND g.expires_at > ?
  AND c.completed_at >= g.period_from AND c.completed_at < g.period_to
  AND c.learner_id IN (SELECT tm.member_id FROM beam_team_members tm WHERE tm.team_id IN (SELECT value FROM json_each(g.teams)))`

/** The shared evidence: each completion with its learner, exact revision, method, certificate and files. */
export async function sharedEvidence(env: Bindings, actor: Actor) {
  const at = now()
  const grants = await all(env, 'SELECT id, teams, period_from AS periodFrom, period_to AS periodTo, expires_at AS expiresAt FROM beam_auditor_grants WHERE member_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY granted_at', actor.id, at)
  insist(grants.length, 'forbidden', 403)
  const completions = await all(env, `SELECT c.id, c.learner_id AS learner, m.name AS learnerName, r.title AS courseTitle, r.number AS revisionNumber, c.course_revision_id AS revision, c.method, c.completed_at AS completedAt, c.expires_at AS expiresAt, k.id AS certificate, k.number AS certificateNumber,
      COALESCE(json_extract(c.evidence_json, '$.attachment'), (SELECT t.attachment_id FROM beam_attempts t WHERE t.assignment_id = c.assignment_id AND t.kind = 'practical' AND t.state = 'accepted' AND t.attachment_id IS NOT NULL ORDER BY t.number DESC LIMIT 1)) AS attachment
    FROM beam_completions c JOIN beam_members m ON m.id = c.learner_id JOIN beam_course_revisions r ON r.id = c.course_revision_id LEFT JOIN beam_certificates k ON k.completion_id = c.id
    WHERE c.id IN (${SHARED}) ORDER BY c.completed_at DESC`, actor.id, at)
  return { grants: grants.map(grant => ({ ...grant, teams: JSON.parse(grant.teams) }) as Row), completions }
}

/** Whether a shared completion carries this certificate or this file. */
export async function sharesCertificate(env: Bindings, actor: Actor, certificate: string) {
  return !!await one(env, `SELECT 1 FROM beam_certificates k WHERE k.id = ? AND k.completion_id IN (${SHARED})`, certificate, actor.id, now())
}
export async function sharesFile(env: Bindings, actor: Actor, attachment: string) {
  return !!await one(env, `SELECT 1 FROM beam_completions c WHERE c.id IN (${SHARED}) AND (json_extract(c.evidence_json, '$.attachment') = ?
    OR EXISTS (SELECT 1 FROM beam_attempts t WHERE t.assignment_id = c.assignment_id AND t.kind = 'practical' AND t.state = 'accepted' AND t.attachment_id = ?))`, actor.id, now(), attachment, attachment)
}

/** Every auditor grant, for the owner. */
export async function auditorGrants(env: Bindings) {
  const at = now()
  return (await all(env, 'SELECT g.id, g.member_id AS member, m.name AS memberName, g.teams, g.period_from AS periodFrom, g.period_to AS periodTo, g.expires_at AS expiresAt, g.revoked_at AS revokedAt FROM beam_auditor_grants g JOIN beam_members m ON m.id = g.member_id ORDER BY g.granted_at DESC, g.rowid DESC'))
    .map(grant => ({ ...grant, teams: JSON.parse(grant.teams), state: grant.revokedAt ? 'revoked' : grant.expiresAt <= at ? 'expired' : 'active' }) as Row)
}
