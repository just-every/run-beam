// ORG-004: who manages each team. The owner names a team's direct managers; the
// owner or one of those direct managers hands the team to someone else for a
// while (coverage), always with an end and a reason. Grants are read on every
// request (actor.ts), so a coverage that ends or is revoked closes at once.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { ACTIVE, expiry } from './units'

async function requireTeam(env: Bindings, team: string) {
  insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ?', team), 'team_not_found', 404)
  return team
}

const directManager = async (env: Bindings, actor: Actor, team: string) => !!await one(env, `SELECT 1 FROM beam_team_managers WHERE team_id = ? AND member_id = ? AND kind = 'direct' AND ${ACTIVE}`, team, actor.id, now())

/** The owner sets a team's direct managers; anyone removed loses the team on their next request. */
export async function setTeamManagers(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const team = await requireTeam(env, input.text('team'))
  const members = [...new Set(input.list('members'))]
  for (const member of members) insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', member), 'person_not_found', 404)
  const at = now()
  const current = (await all<{ member_id: string }>(env, `SELECT member_id FROM beam_team_managers WHERE team_id = ? AND kind = 'direct' AND ${ACTIVE}`, team, at)).map(row => row.member_id)
  await commit(env, [
    ...current.filter(member => !members.includes(member)).map(member => stmt(env, `UPDATE beam_team_managers SET revoked_by = ?, revoked_at = ? WHERE team_id = ? AND member_id = ? AND kind = 'direct' AND ${ACTIVE}`, actor.id, at, team, member, at)),
    ...members.filter(member => !current.includes(member)).map(member => stmt(env, "INSERT INTO beam_team_managers (id, team_id, member_id, kind, granted_by, granted_at) VALUES (?, ?, ?, 'direct', ?, ?)", newId(), team, member, actor.id, at)),
  ], { actor, action: 'team.managers', subject: team, detail: { members, previous: current } })
  return { team, managers: members }
}

/** Temporary coverage of a team, granted by the owner or one of its direct managers, ending on a set date or instant. */
export async function grantCoverage(env: Bindings, actor: Actor, input: Input) {
  const team = await requireTeam(env, input.text('team'))
  insist(actor.owner || await directManager(env, actor, team), 'learner_outside_your_team', 403)
  const member = input.text('member')
  insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', member), 'person_not_found', 404)
  const expiresAt = await expiry(env, input)
  insist(expiresAt, 'coverage_end_required')
  const reason = input.text('reason', { max: 500 })
  const id = newId()
  await commit(env, [stmt(env, "INSERT INTO beam_team_managers (id, team_id, member_id, kind, reason, expires_at, granted_by, granted_at) VALUES (?, ?, ?, 'coverage', ?, ?, ?, ?)", id, team, member, reason, expiresAt, actor.id, now())],
    { actor, action: 'team.coverage', subject: id, detail: { team, member, expiresAt, reason } })
  return { id, team, member, expiresAt }
}

/** Ends a coverage early: the owner, or whoever granted it. */
export async function endCoverage(env: Bindings, actor: Actor, input: Input) {
  const grant = await one<{ id: string; granted_by: string }>(env, "SELECT id, granted_by FROM beam_team_managers WHERE id = ? AND kind = 'coverage'", input.text('grant'))
  insist(grant, 'grant_not_active', 404)
  insist(actor.owner || grant.granted_by === actor.id, 'forbidden', 403)
  const at = now()
  const result = await env.DB.batch([
    stmt(env, `UPDATE beam_team_managers SET revoked_by = ?, revoked_at = ? WHERE id = ? AND ${ACTIVE}`, actor.id, at, grant.id, at),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', at, actor.id, 'team.coverage.end', grant.id, '{}'),
  ])
  insist(result[0].meta.changes === 1, 'grant_not_active', 404)
  return { id: grant.id, endedAt: at }
}

/** Every manager grant of the given teams (null: all), with its state. */
export async function teamManagers(env: Bindings, teams: string[] | null) {
  const at = now(), scope = teams && JSON.stringify(teams)
  return (await all(env, `SELECT g.id, g.team_id AS team, g.member_id AS member, m.name AS memberName, g.kind, g.reason, g.expires_at AS expiresAt, g.granted_by AS grantedBy, g.granted_at AS grantedAt, g.revoked_at AS revokedAt
    FROM beam_team_managers g JOIN beam_members m ON m.id = g.member_id WHERE (? IS NULL OR g.team_id IN (SELECT value FROM json_each(?))) ORDER BY g.granted_at, g.rowid`, scope, scope))
    .map(grant => ({ ...grant, state: grant.revokedAt ? 'revoked' : grant.expiresAt && grant.expiresAt <= at ? 'expired' : 'active' }) as Row)
}
