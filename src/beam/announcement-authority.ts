// NOTICE-006: session authority is live at send, reply and inbox read. A renewed
// course-covering grant restores the instructor's inbox; it never reroutes replies.
import type { Bindings } from '../auth.server'
import { dashboardAuthority, type Actor } from './actor'
import { all, now, one } from './core'

type Basis = 'instructor' | 'admin'
export async function sessionAnnouncementAuthority(env: Bindings, member: string, session: string, basis?: string) {
  const slot = await one<{ course: string; instructor: string | null; unit: string | null }>(env,
    `SELECT s.course_id AS course, s.instructor_id AS instructor, c.unit_id AS unit FROM beam_sessions s
     JOIN beam_courses c ON c.id = s.course_id WHERE s.id = ? AND s.state = 'scheduled'`, session)
  if (!slot) return null
  const actor = await dashboardAuthority(env, member)
  if (!actor) return null
  if ((!basis || basis === 'instructor') && slot.instructor === member) {
    const grant = await one<{ id: string }>(env, `SELECT id FROM beam_instructor_grants WHERE member_id = ? AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ?) AND (unit_id IS NULL OR unit_id = ?) ORDER BY granted_at DESC, id LIMIT 1`, member, now(), slot.unit)
    if (grant) return { basis: 'instructor' as Basis, grant: grant.id }
  }
  if ((!basis || basis === 'admin') && (actor.owner || (slot.unit && actor.adminUnits.includes(slot.unit)))) return { basis: 'admin' as Basis, grant: null }
  return null
}

/** Only audiences the person can send to now are offered in the existing form. */
export async function announcementSessions(env: Bindings, actor: Actor) {
  const slots = await all<{ id: string; title: string }>(env, "SELECT id, title FROM beam_sessions WHERE state = 'scheduled' ORDER BY start_date, start_time, title")
  const allowed = await Promise.all(slots.map(async slot => await sessionAnnouncementAuthority(env, actor.id, slot.id) ? slot : null))
  return allowed.filter((slot): slot is { id: string; title: string } => slot !== null)
}
