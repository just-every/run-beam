import type { Bindings } from '../auth.server'
import { dashboardAuthority, isManager, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt } from './core'
import type { Input } from './input'

export async function authorizeErrorFeed(env: Bindings, actor: Actor, input: Input) {
 insist(isManager(actor) && !actor.agent, 'human_manager_required', 403)
 insist(input.flag('consent'), 'explicit_scope_consent_required')
 const course = input.text('course'), role = input.text('jobRole', { max: 120 }), teams = [...new Set(input.list('teams'))]
 insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id=? AND published_revision_id IS NOT NULL', course), 'course_not_published', 409)
 insist(teams.length && teams.every(id => actor.owner || actor.managedTeams.includes(id)), 'feed_scope_forbidden', 403)
 for (const id of teams) insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id=?', id), 'team_not_found', 404)
 const id = newId()
 await commit(env, [stmt(env, 'INSERT INTO beam_error_feeds VALUES(?,?,?,?,?,?,NULL)', id, actor.id, course, role, JSON.stringify(teams), now())], { actor, action: 'error-feed.authorize', subject: id, detail: { course, teams, jobRole: role } })
 return { id }
}

export async function errorFeed(env: Bindings, actor: Actor, id: string) {
 const feed = await one(env, 'SELECT * FROM beam_error_feeds WHERE id=?', id)
 insist(feed && (actor.owner || actor.id === feed.actor), 'feed_not_found', 404)
 insist(!feed.revoked_at, 'feed_revoked', 409)
 const authority = await dashboardAuthority(env, feed.actor), teams: string[] = JSON.parse(feed.teams_json)
 insist(authority && isManager(authority) && (authority.owner || teams.every(id => authority.managedTeams.includes(id))), 'feed_authority_changed', 409)
 return feed
}

export async function revokeErrorFeed(env: Bindings, actor: Actor, input: Input) {
 insist(!actor.agent, 'human_manager_required', 403)
 const feed = await one(env, 'SELECT * FROM beam_error_feeds WHERE id=?', input.text('feed'))
 insist(feed && (actor.owner || actor.id === feed.actor), 'feed_not_found', 404)
 await commit(env, [stmt(env, 'UPDATE beam_error_feeds SET revoked_at=COALESCE(revoked_at,?) WHERE id=?', now(), feed.id),
 stmt(env, 'UPDATE beam_diagnosis_imports SET withdrawn_at=COALESCE(withdrawn_at,?) WHERE feed=?', now(), feed.id),
 stmt(env, 'DELETE FROM beam_diagnosis_observations WHERE import_id IN (SELECT id FROM beam_diagnosis_imports WHERE feed=?)', feed.id)], { actor, action: 'error-feed.revoke', subject: feed.id })
 return { id: feed.id, revoked: true }
}

export async function errorFeeds(env: Bindings, actor: Actor) {
 insist(isManager(actor), 'forbidden', 403)
 return all(env, 'SELECT id,course,job_role AS jobRole,teams_json AS teams,revoked_at AS revokedAt FROM beam_error_feeds WHERE ?=1 OR actor=? ORDER BY authorized_at DESC', actor.owner ? 1 : 0, actor.id)
}

// Scope shrink invalidates the entire comparison before any aggregate or citation is released.
export async function reconcileErrorImport(env: Bindings, row: any) {
 if (!row.feed || row.withdrawn_at) return row
 const feed = await one(env, 'SELECT * FROM beam_error_feeds WHERE id=?', row.feed)
 const authority = feed && await dashboardAuthority(env, feed.actor)
 const teams: string[] = feed ? JSON.parse(feed.teams_json) : []
 const eligible = await all(env, `SELECT DISTINCT m.id FROM beam_members m JOIN beam_team_members t ON t.member_id=m.id WHERE t.team_id IN (SELECT value FROM json_each(?)) AND lower(m.job_role)=lower(?) AND m.employment<>'terminated'`, JSON.stringify(teams), row.job_role)
 const cohort: string[] = JSON.parse(row.cohort_json)
 const valid = feed && !feed.revoked_at && authority && isManager(authority) && (authority.owner || teams.every(id => authority.managedTeams.includes(id))) && cohort.every(id => eligible.some(m => m.id===id))
 if (!valid) {
  const at = now()
  await env.DB.batch([stmt(env, 'UPDATE beam_diagnosis_imports SET withdrawn_at=? WHERE id=?', at, row.id), stmt(env, 'DELETE FROM beam_diagnosis_observations WHERE import_id=?', row.id)])
  row.withdrawn_at = at
 }
 return row
}
