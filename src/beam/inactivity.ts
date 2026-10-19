// AUTO-007: deactivate inactive people under the owner's reviewed policy. The owner sets how many days without a sign-in
// make someone inactive (in the business time zone), how long the notice lasts, and which teams and roles are
// protected; the owner, assessors with evidence waiting for them and anyone with an open blocker or an exception that
// holds (AUTO-006) are always protected. Saving changes the policy's version and switches it off until a write-free
// preview of that version. A run gives each newly inactive person an in-app notice, cancels a notice once its person
// signs in or becomes protected, and removes access through Base when a notice runs out (sessions revoked, evidence
// kept); running again changes nothing more. The owner restores access, and the person signs in afresh.
import type { Bindings } from '../auth.server'
import { requireOwner, ROLES, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { changeAccess, requireBusiness } from './people'
import { DAY, calendarDays } from './time'

interface Policy { inactiveDays: number; noticeDays: number; excludedTeams: string[]; excludedRoles: string[]; version: number; previewedVersion: number | null; enabled: boolean }

export async function inactivityPolicy(env: Bindings): Promise<Policy | null> {
  const row = await one(env, 'SELECT * FROM beam_inactivity_policy WHERE id = 1')
  return row ? { inactiveDays: row.inactive_days, noticeDays: row.notice_days, excludedTeams: JSON.parse(row.excluded_teams), excludedRoles: JSON.parse(row.excluded_roles), version: row.version, previewedVersion: row.previewed_version, enabled: row.enabled === 1 } : null
}

export async function savePolicy(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const inactiveDays = input.integer('inactiveDays', { min: 30, max: 730 })!, noticeDays = input.integer('noticeDays', { min: 7, max: 60 })!
  const excludedTeams = [...new Set(input.list('excludedTeams'))], excludedRoles = [...new Set(input.list('excludedRoles'))]
  for (const team of excludedTeams) insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ?', team), 'team_not_found', 404)
  insist(excludedRoles.every(role => (ROLES as readonly string[]).includes(role)), 'invalid_roles')
  const version = ((await inactivityPolicy(env))?.version ?? 0) + 1
  await commit(env, [stmt(env, `INSERT INTO beam_inactivity_policy (id, inactive_days, notice_days, excluded_teams, excluded_roles, version, previewed_version, enabled, updated_by, updated_at) VALUES (1, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET inactive_days = excluded.inactive_days, notice_days = excluded.notice_days, excluded_teams = excluded.excluded_teams, excluded_roles = excluded.excluded_roles, version = excluded.version, previewed_version = NULL, enabled = 0, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    inactiveDays, noticeDays, JSON.stringify(excludedTeams), JSON.stringify(excludedRoles), version, actor.id, now())], { actor, action: 'inactivity.policy', subject: 'policy', detail: { version, inactiveDays, noticeDays, excludedTeams, excludedRoles } })
  return { version }
}

/** Everyone with an active sign-in account and their last sign-in (or, never signed in, when the account began). */
async function people(env: Bindings, policy: Policy) {
  const at = now(), zone = (await requireBusiness(env)).timezone
  const rows = await all(env, `SELECT m.id, m.name, o.role = 'owner' AS owner, COALESCE((SELECT MAX(s.created_at) FROM oa_sessions s WHERE s.operator_id = o.id), o.created_at) AS lastSignInAt,
      (SELECT json_group_array(role) FROM beam_member_roles r WHERE r.member_id = m.id) AS roles,
      (SELECT json_group_array(team_id) FROM beam_team_members t WHERE t.member_id = m.id) AS teams,
      EXISTS (SELECT 1 FROM beam_attempts t JOIN beam_assessment_revisions s ON s.id = t.assessment_revision_id WHERE s.assessor_id = m.id AND t.state = 'awaiting_review' AND t.reset_id IS NULL) AS assessing,
      EXISTS (SELECT 1 FROM beam_blockers b JOIN beam_assignments a ON a.id = b.assignment_id WHERE b.learner_id = m.id AND b.state = 'open' AND a.status = 'open')
        OR EXISTS (SELECT 1 FROM beam_exceptions e JOIN beam_assignments a ON a.id = e.assignment_id WHERE a.learner_id = m.id AND a.status = 'open' AND e.ends_at > ?) AS excepted
    FROM beam_members m JOIN oa_operators o ON o.id = m.operator_id WHERE o.status = 'active' ORDER BY m.name`, at)
  return rows.map(row => {
    const roles: string[] = JSON.parse(row.roles), teams: string[] = JSON.parse(row.teams)
    const protectedBy = row.owner ? 'owner' : row.assessing ? 'evidence waiting for them as assessor' : row.excepted ? 'open blocker or exception'
      : teams.some(team => policy.excludedTeams.includes(team)) ? 'protected team' : roles.some(role => policy.excludedRoles.includes(role)) ? 'protected role' : null
    return { id: row.id as string, name: row.name as string, lastSignInAt: row.lastSignInAt as number, idleDays: calendarDays(row.lastSignInAt, at, zone), protectedBy }
  })
}

const openNotices = async (env: Bindings) => await all(env, "SELECT n.id, n.member_id AS member, m.name, n.policy_version AS policyVersion, n.last_sign_in_at AS lastSignInAt, n.noticed_at AS noticedAt, n.deactivate_at AS deactivateAt FROM beam_inactivity_notices n JOIN beam_members m ON m.id = n.member_id WHERE n.state = 'open' ORDER BY n.deactivate_at")

export type Plan = Awaited<ReturnType<typeof plan>>
/** What a run would do now, without doing it: notices to give, notices to cancel, access to remove, and who is protected. */
export async function plan(env: Bindings, policy: Policy) {
  const at = now(), everyone = await people(env, policy), open = await openNotices(env)
  const byMember = new Map(open.map(notice => [notice.member, notice]))
  const notify: Row[] = [], cancel: Row[] = [], deactivate: Row[] = [], protectedPeople: Row[] = []
  for (const person of everyone) {
    const notice = byMember.get(person.id)
    if (person.protectedBy) { protectedPeople.push(person); if (notice) cancel.push({ ...notice, reason: person.protectedBy }); continue }
    if (notice) {
      if (person.lastSignInAt > notice.noticedAt) cancel.push({ ...notice, reason: 'signed in' })
      else if (notice.deactivateAt <= at) deactivate.push(notice)
    } else if (person.idleDays >= policy.inactiveDays) notify.push(person)
  }
  return { notify, cancel, deactivate, protected: protectedPeople, open }
}

/** The preview the owner reviews before enabling: it writes nothing but the reviewed version. */
export async function previewPolicy(env: Bindings, actor: Actor) {
  requireOwner(actor)
  const policy = await inactivityPolicy(env)
  insist(policy, 'policy_not_set', 409)
  const preview = await plan(env, policy)
  await commit(env, [stmt(env, 'UPDATE beam_inactivity_policy SET previewed_version = version WHERE id = 1')], { actor, action: 'inactivity.preview', subject: 'policy', detail: { version: policy.version, notify: preview.notify.length, deactivate: preview.deactivate.length } })
  return { version: policy.version, ...preview }
}

export async function setPolicyEnabled(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const policy = await inactivityPolicy(env)
  insist(policy, 'policy_not_set', 409)
  const enabled = input.text('enabled') === 'true'
  insist(!enabled || policy.previewedVersion === policy.version, 'preview_required', 409)
  await commit(env, [stmt(env, 'UPDATE beam_inactivity_policy SET enabled = ? WHERE id = 1', enabled ? 1 : 0)], { actor, action: enabled ? 'inactivity.enable' : 'inactivity.disable', subject: 'policy', detail: { version: policy.version } })
  return { enabled }
}

/** The job, run by the owner: every step is keyed to an open notice, so a second run finds nothing left to do. */
export async function runPolicy(env: Bindings, actor: Actor, _input: Input, request: Request) {
  requireOwner(actor)
  const policy = await inactivityPolicy(env)
  insist(policy?.enabled, 'policy_not_enabled', 409)
  const work = await plan(env, policy), at = now()
  for (const notice of work.cancel) await commit(env, [stmt(env, "UPDATE beam_inactivity_notices SET state = 'cancelled', closed_at = ?, close_reason = ? WHERE id = ? AND state = 'open'", at, notice.reason, notice.id)], { actor, action: 'inactivity.cancel', subject: notice.member, detail: { notice: notice.id, reason: notice.reason, version: policy.version } })
  for (const person of work.notify) await commit(env, [stmt(env, "INSERT OR IGNORE INTO beam_inactivity_notices (id, member_id, policy_version, last_sign_in_at, noticed_at, deactivate_at, state) VALUES (?, ?, ?, ?, ?, ?, 'open')", newId(), person.id, policy.version, person.lastSignInAt, at, at + policy.noticeDays * DAY)],
    { actor, action: 'inactivity.notice', subject: person.id, detail: { version: policy.version, inactiveDays: policy.inactiveDays, noticeDays: policy.noticeDays, idleDays: person.idleDays, lastSignInAt: person.lastSignInAt } })
  for (const notice of work.deactivate) {
    await changeAccess(env, request, actor, notice.member, 'inactive', { rule: 'inactivity', version: policy.version, notice: notice.id, lastSignInAt: notice.lastSignInAt })
    await commit(env, [stmt(env, "UPDATE beam_inactivity_notices SET state = 'deactivated', closed_at = ?, close_reason = 'notice ran out' WHERE id = ? AND state = 'open'", at, notice.id)], { actor, action: 'inactivity.deactivate', subject: notice.member, detail: { notice: notice.id, version: policy.version, inactiveDays: policy.inactiveDays, noticeDays: policy.noticeDays, lastSignInAt: notice.lastSignInAt } })
  }
  return { version: policy.version, noticed: work.notify.map(person => person.id), cancelled: work.cancel.map(notice => notice.member), deactivated: work.deactivate.map(notice => notice.member) }
}

/** The owner's view: the policy, its notices (open and closed) and, when asked, the preview. */
export async function inactivityView(env: Bindings, actor: Actor) {
  requireOwner(actor)
  const notices = await all(env, 'SELECT n.id, n.member_id AS member, m.name, n.policy_version AS policyVersion, n.noticed_at AS noticedAt, n.deactivate_at AS deactivateAt, n.state, n.closed_at AS closedAt, n.close_reason AS closeReason FROM beam_inactivity_notices n JOIN beam_members m ON m.id = n.member_id ORDER BY n.noticed_at DESC LIMIT 200')
  return { policy: await inactivityPolicy(env), notices }
}

/** A person's own open notice, for My learning. */
export const myNotice = async (env: Bindings, actor: Actor) => await one(env, "SELECT noticed_at AS noticedAt, deactivate_at AS deactivateAt, last_sign_in_at AS lastSignInAt FROM beam_inactivity_notices WHERE member_id = ? AND state = 'open'", actor.id)
