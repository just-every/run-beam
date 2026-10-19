// ORG-005, instructor half: the owner grants a person instructor access for every course or for one business unit's
// courses, and a unit's learning administrator for their own units' courses only, optionally until an end date;
// grants are revocable and audited. Only an active holder whose grant covers the course can be named as a session's
// instructor (LIVE-001), and an instructor keeps the roster, attendance and calendar of the sessions they are named on
// only while such a grant lasts (read on every request); their earlier records stay. An instructor alters no
// assessment, completion (beyond attendance under LIVE-003's revision rule), person, session or policy: those doors
// check their own roles.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { ACTIVE, expiry } from './units'

/** Whether the member holds an active instructor grant covering the course. */
export async function instructs(env: Bindings, member: string, course: string) {
  return !!await one(env, `SELECT 1 FROM beam_instructor_grants g WHERE g.member_id = ? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?)
    AND (g.unit_id IS NULL OR g.unit_id = (SELECT unit_id FROM beam_courses WHERE id = ?))`, member, now(), course)
}

export async function grantInstructor(env: Bindings, actor: Actor, input: Input) {
  const member = input.text('member')
  insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', member), 'person_not_found', 404)
  const unit = input.text('unit', { optional: true }) || null
  if (!actor.owner) {
    insist(actor.adminUnits.length, 'forbidden', 403)
    insist(unit && actor.adminUnits.includes(unit), 'outside_your_units', 403)
  }
  insist(unit === null || await one(env, 'SELECT 1 FROM beam_units WHERE id = ?', unit), 'unit_not_found', 404)
  const expiresAt = await expiry(env, input)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_instructor_grants (id, member_id, unit_id, expires_at, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?)', id, member, unit, expiresAt, actor.id, now())],
    { actor, action: 'instructor.grant', subject: id, detail: { member, unit, expiresAt } })
  return { id, member, unit, expiresAt }
}

export async function revokeInstructor(env: Bindings, actor: Actor, input: Input) {
  const grant = await one(env, `SELECT * FROM beam_instructor_grants WHERE id = ? AND ${ACTIVE}`, input.text('grant'), now())
  insist(grant, 'grant_not_active', 404)
  insist(actor.owner || (grant.unit_id && actor.adminUnits.includes(grant.unit_id)), 'forbidden', 403)
  await commit(env, [stmt(env, 'UPDATE beam_instructor_grants SET revoked_by = ?, revoked_at = ? WHERE id = ?', actor.id, now(), grant.id)], { actor, action: 'instructor.revoke', subject: grant.id, detail: { member: grant.member_id } })
  return { id: grant.id }
}

/** The grants this person may see and manage: every grant for the owner, their units' for a learning administrator. */
export async function instructorGrants(env: Bindings, actor: Actor) {
  insist(actor.owner || actor.adminUnits.length, 'forbidden', 403)
  const at = now()
  const rows = await all(env, 'SELECT g.id, g.member_id AS member, m.name AS memberName, g.unit_id AS unit, u.name AS unitName, g.expires_at AS expiresAt, g.revoked_at AS revokedAt FROM beam_instructor_grants g JOIN beam_members m ON m.id = g.member_id LEFT JOIN beam_units u ON u.id = g.unit_id ORDER BY g.granted_at DESC, g.rowid DESC')
  return rows.filter(row => actor.owner || (row.unit && actor.adminUnits.includes(row.unit)))
    .map(row => ({ ...row, state: row.revokedAt ? 'revoked' : row.expiresAt !== null && row.expiresAt <= at ? 'expired' : 'active' }) as Row)
}
