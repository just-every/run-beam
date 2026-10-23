// NOTICE-006: session authority is live at send, reply and inbox read. A renewed
// course-covering grant restores the instructor's inbox; it never reroutes replies.
import type { Bindings } from '../auth.server'
import { dashboardAuthority, isManager, type Actor } from './actor'
import { inScope } from './scope'
import { all, now, one } from './core'

export async function sessionAnnouncementAuthority(env: Bindings, member: string, session: string, basis?: string) {
  const at = now()
  const authority = await one<{ instructor: string | null; grant: string | null; role: string; admin: number }>(env, `
    SELECT s.instructor_id AS instructor, o.role,
      (SELECT g.id FROM beam_instructor_grants g WHERE g.member_id = m.id AND g.revoked_at IS NULL
       AND (g.expires_at IS NULL OR g.expires_at > ?) AND (g.unit_id IS NULL OR g.unit_id = c.unit_id)
       ORDER BY g.granted_at DESC, g.id LIMIT 1) AS grant,
      EXISTS(SELECT 1 FROM beam_admin_grants g WHERE g.member_id = m.id AND g.unit_id = c.unit_id
       AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?)) AS admin
    FROM beam_sessions s JOIN beam_courses c ON c.id = s.course_id JOIN beam_members m ON m.id = ?
    JOIN oa_operators o ON o.id = m.operator_id AND o.status = 'active'
    WHERE s.id = ? AND s.state = 'scheduled'`, at, at, member, session)
  if (!authority) return null
  if ((!basis || basis === 'instructor') && authority.instructor === member && authority.grant) return { basis: 'instructor', grant: authority.grant }
  if ((!basis || basis === 'admin') && (authority.role === 'owner' || authority.admin)) return { basis: 'admin', grant: null }
  return null
}

/** Only audiences the person can send to now are offered in the existing form. */
export async function announcementSessions(env: Bindings, actor: Actor) {
  return await all<{ id: string; title: string }>(env, `SELECT s.id, s.title FROM beam_sessions s JOIN beam_courses c ON c.id = s.course_id
    WHERE s.state = 'scheduled' AND (? OR c.unit_id IN (SELECT value FROM json_each(?)) OR
      (s.instructor_id = ? AND EXISTS(SELECT 1 FROM beam_instructor_grants g WHERE g.member_id = ? AND g.revoked_at IS NULL
       AND (g.expires_at IS NULL OR g.expires_at > ?) AND (g.unit_id IS NULL OR g.unit_id = c.unit_id))))
    ORDER BY s.start_date, s.start_time, s.title`, actor.owner ? 1 : 0, JSON.stringify(actor.adminUnits), actor.id, actor.id, now())
}

/** New audience selectors disclose only groups with people inside existing management scope. */
export async function announcementGroups(env: Bindings, actor: Actor) {
  if (!(isManager(actor) || actor.adminUnits.length)) return { locations: [], cohorts: [] }
  const scope = actor.owner ? null : JSON.stringify(actor.learners)
  const locations = await all<{ id: string; name: string }>(env, `SELECT DISTINCT location AS id,location AS name FROM beam_members
    WHERE location IS NOT NULL AND location<>'' AND employment<>'terminated'
      AND (?1 IS NULL OR id IN (SELECT value FROM json_each(?1))) ORDER BY location`, scope)
  const cohorts = await all<{ id: string; name: string }>(env, `SELECT a.id,a.name FROM beam_audiences a
    WHERE a.state='active' AND EXISTS(SELECT 1 FROM beam_audience_members am JOIN beam_members m ON m.id=am.member_id
      WHERE am.audience_id=a.id AND am.left_at IS NULL AND m.employment<>'terminated'
        AND (?1 IS NULL OR m.id IN (SELECT value FROM json_each(?1)))) ORDER BY a.name`, scope)
  return { locations, cohorts }
}

/** A saved audience never grants continuing access to a learner's private replies. */
export async function announcementReplyAuthority(env: Bindings, member: string, kind: string, target: string, basis: string, learner: string) {
  if (kind === 'session') return !!await sessionAnnouncementAuthority(env, member, target, basis)
  const actor = await dashboardAuthority(env, member)
  if (!actor || !(isManager(actor) || actor.adminUnits.length) || !inScope(actor, learner)) return false
  if (kind === 'team') return actor.owner || !!actor.teams?.includes(target)
  if (kind === 'cohort') return !!await one(env, "SELECT 1 FROM beam_audiences WHERE id=? AND state='active'", target)
  return true
}
