// REPORT-002: a saved selection never grants report authority. Every read uses both people's live authority.
import type { Bindings } from '../auth.server'
import { dashboardAuthority, type Actor } from './actor'
import { all, commit, insist, newId, now, one, sha256Hex, stmt } from './core'
import type { Input } from './input'
import { cell, reportFilters, trainingReport, type Filters } from './report'
import { IN_SCOPE, learnerScope, permits, teamScope } from './scope'
import { DAY } from './time'

export const DASHBOARD_FIELDS = ['name', 'course', 'due', 'status', 'completedAt'] as const
export type DashboardField = typeof DASHBOARD_FIELDS[number]
export const DASHBOARD_LABELS: Record<DashboardField, string> = { name: 'Name', course: 'Course', due: 'Due (UTC)', status: 'Status', completedAt: 'Completed (UTC)' }
interface SavedDashboard { id: string; creator: string; name: string; filters: Filters; fields: DashboardField[]; createdAt: number; revokedAt: number | null }
const SELECT = 'SELECT id, creator_id AS creator, name, filters, fields, created_at AS createdAt, revoked_at AS revokedAt FROM beam_dashboards'
const decode = (row: any): SavedDashboard => ({ ...row, filters: JSON.parse(row.filters), fields: JSON.parse(row.fields) })
const human = (actor: Actor) => insist(!actor.agent && !actor.viewAs, 'forbidden', 403)
const keyHash = (key: string) => sha256Hex(new TextEncoder().encode(key))

async function saved(env: Bindings, id: string) {
  const row = await one(env, `${SELECT} WHERE id = ?`, id)
  insist(row && !row.revokedAt, 'dashboard_not_found', 404)
  return decode(row)
}
const manages = (actor: Actor, dashboard: SavedDashboard) => actor.owner || actor.id === dashboard.creator

/** null means no report authority, team authority, or common people. Empty report results are still valid. */
async function intersection(env: Bindings, creator: Actor | null, viewer: Actor, filters: Filters) {
  if (!creator || !permits(creator, 'reports') || !permits(viewer, 'reports')) return null
  for (const actor of [creator, viewer]) {
    const teams = teamScope(actor, 'reports')
    if (filters.team && teams !== null && !JSON.parse(teams).includes(filters.team)) return null
  }
  const left = learnerScope(creator, 'reports'), right = learnerScope(viewer, 'reports')
  const people = await all<{ id: string }>(env, `SELECT id FROM beam_members WHERE ${IN_SCOPE('id')} AND ${IN_SCOPE('id')}
    AND (? = '' OR id IN (SELECT member_id FROM beam_team_members WHERE team_id = ?))`, left, left, right, right, filters.team, filters.team)
  return people.length ? new Set(people.map(person => person.id)) : null
}

async function selection(env: Bindings, actor: Actor, dashboard: SavedDashboard) {
  human(actor)
  const creator = actor.id === dashboard.creator ? actor : await dashboardAuthority(env, dashboard.creator)
  const people = await intersection(env, creator, actor, dashboard.filters)
  insist(people, 'dashboard_scope_unavailable', 403)
  return people
}

export async function createDashboard(env: Bindings, actor: Actor, input: Input) {
  human(actor)
  const url = new URL('https://selection.invalid')
  for (const key of ['course', 'team', 'status']) url.searchParams.set(key, input.text(key, { optional: true }))
  const filters = reportFilters(url), name = input.text('name', { max: 120 })
  const fields = [...new Set(input.list('fields'))] as DashboardField[]
  insist(fields.length && fields.every(field => DASHBOARD_FIELDS.includes(field)), 'invalid_dashboard_fields')
  insist(await intersection(env, actor, actor, filters), 'dashboard_scope_unavailable', 403)
  if (filters.course) insist(await one(env, 'SELECT id FROM beam_courses WHERE id = ? UNION SELECT id FROM beam_external_requirements WHERE id = ?', filters.course, filters.course), 'course_not_found', 404)
  const id = newId(), createdAt = now()
  await commit(env, [stmt(env, 'INSERT INTO beam_dashboards (id, creator_id, name, filters, fields, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, actor.id, name, JSON.stringify(filters), JSON.stringify(fields), createdAt)],
    { actor, action: 'dashboard.create', subject: id, detail: { name, filters, fields } })
  return { id, name, filters, fields, createdAt }
}

async function sharing(env: Bindings, actor: Actor, input: Input) {
  human(actor)
  const dashboard = await saved(env, input.text('dashboard'))
  insist(manages(actor, dashboard), 'forbidden', 403)
  await selection(env, actor, dashboard)
  const viewerId = input.has('viewer') ? input.text('viewer') : (await one<{ id: string }>(env, 'SELECT id FROM beam_members WHERE lower(email) = ?', input.text('viewerEmail').toLowerCase()))?.id
  insist(viewerId, 'viewer_report_authority_required', 403)
  const viewer = await dashboardAuthority(env, viewerId)
  const creator = await dashboardAuthority(env, dashboard.creator)
  insist(viewer && await intersection(env, creator, viewer, dashboard.filters), 'viewer_report_authority_required', 403)
  return { dashboard, viewerId }
}

export async function shareDashboard(env: Bindings, actor: Actor, input: Input) {
  const { dashboard, viewerId } = await sharing(env, actor, input)
  const id = newId()
  await commit(env, [stmt(env, "INSERT INTO beam_dashboard_shares (id, dashboard_id, viewer_id, kind, granted_at, granted_by) VALUES (?, ?, ?, 'named', ?, ?)", id, dashboard.id, viewerId, now(), actor.id)],
    { actor, action: 'dashboard.share', subject: dashboard.id, detail: { share: id, viewer: viewerId } })
  return { id, dashboard: dashboard.id, viewer: viewerId }
}

export async function linkDashboard(env: Bindings, actor: Actor, input: Input) {
  const { dashboard, viewerId } = await sharing(env, actor, input)
  const rawExpiry = input.text('expiresAt')
  const expiresAt = Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(rawExpiry) ? rawExpiry + 'Z' : rawExpiry), at = now()
  insist(Number.isFinite(expiresAt) && expiresAt > at && expiresAt <= at + 90 * DAY, 'dashboard_expiry_within_90_days_required')
  const key = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''), id = newId()
  await commit(env, [stmt(env, "INSERT INTO beam_dashboard_shares (id, dashboard_id, viewer_id, kind, token_hash, expires_at, granted_at, granted_by) VALUES (?, ?, ?, 'link', ?, ?, ?, ?)", id, dashboard.id, viewerId, await keyHash(key), expiresAt, at, actor.id)],
    { actor, action: 'dashboard.link', subject: dashboard.id, detail: { share: id, viewer: viewerId, expiresAt } })
  return { id, dashboard: dashboard.id, viewer: viewerId, expiresAt, url: `/app/dashboards/${dashboard.id}?key=${key}` }
}

/** Revocation remains available to the owner and creator even after their report authority ends. */
export async function revokeDashboard(env: Bindings, actor: Actor, input: Input) {
  human(actor)
  const dashboard = await saved(env, input.text('dashboard'))
  insist(manages(actor, dashboard), 'forbidden', 403)
  const at = now()
  await commit(env, [stmt(env, 'UPDATE beam_dashboards SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL', at, actor.id, dashboard.id)], { actor, action: 'dashboard.revoke', subject: dashboard.id })
  return { id: dashboard.id, revokedAt: at }
}

export async function revokeDashboardShare(env: Bindings, actor: Actor, input: Input) {
  human(actor)
  const id = input.text('share'), share = await one(env, 'SELECT dashboard_id AS dashboard FROM beam_dashboard_shares WHERE id = ? AND revoked_at IS NULL', id)
  insist(share, 'dashboard_share_not_found', 404)
  const dashboard = await saved(env, share.dashboard)
  insist(manages(actor, dashboard), 'forbidden', 403)
  const at = now()
  await commit(env, [stmt(env, 'UPDATE beam_dashboard_shares SET revoked_at = ?, revoked_by = ? WHERE id = ?', at, actor.id, id)], { actor, action: 'dashboard.share.revoke', subject: dashboard.id, detail: { share: id } })
  return { id, revokedAt: at }
}

export async function readDashboard(env: Bindings, actor: Actor, id: string, url: URL) {
  human(actor)
  const dashboard = await saved(env, id), key = url.searchParams.get('key')
  // Supplying a link always checks its exact intended viewer, expiry and revocation, even for an owner.
  if (key !== null) {
    insist(/^[a-f0-9]{64}$/.test(key), 'dashboard_not_found', 404)
    // OPS-007: a link an installation restore brought back (restored_at) never opens again; the archive carried no key hash.
    insist(await one(env, "SELECT 1 FROM beam_dashboard_shares WHERE dashboard_id = ? AND viewer_id = ? AND kind = 'link' AND token_hash = ? AND revoked_at IS NULL AND restored_at IS NULL AND expires_at > ?", id, actor.id, await keyHash(key), now()), 'dashboard_not_found', 404)
  } else if (!manages(actor, dashboard)) {
    insist(await one(env, "SELECT 1 FROM beam_dashboard_shares WHERE dashboard_id = ? AND viewer_id = ? AND kind = 'named' AND revoked_at IS NULL", id, actor.id), 'dashboard_not_found', 404)
  }
  const people = await selection(env, actor, dashboard)
  const report = await trainingReport(env, actor, dashboard.filters)
  const values = (row: any): Record<DashboardField, unknown> => ({ name: row.learnerName, course: row.courseTitle, due: row.dueAt ?? null, status: row.status, completedAt: row.completedAt ?? null })
  const rows = report.rows.filter(row => people.has(row.learner)).map(row => Object.fromEntries(dashboard.fields.map(field => [field, values(row)[field]])))
  return { id, name: dashboard.name, filters: dashboard.filters, fields: dashboard.fields, asOf: report.asOf, data: 'live' as const, rows }
}

export async function listDashboards(env: Bindings, actor: Actor) {
  human(actor)
  const rows = await all(env, `${SELECT} WHERE revoked_at IS NULL AND (? = 1 OR creator_id = ? OR id IN
    (SELECT dashboard_id FROM beam_dashboard_shares WHERE viewer_id = ? AND kind = 'named' AND revoked_at IS NULL)) ORDER BY created_at DESC`, Number(actor.owner), actor.id, actor.id)
  const visible = []
  for (const row of rows) {
    const dashboard = decode(row), creator = await dashboardAuthority(env, dashboard.creator)
    const available = !!await intersection(env, creator, actor, dashboard.filters)
    if (available || manages(actor, dashboard)) visible.push({ ...dashboard, manageable: manages(actor, dashboard), available })
  }
  return visible
}

/** Management metadata carries no report rows, secrets or reusable link tokens. */
export async function dashboardManagement(env: Bindings, actor: Actor, id: string) {
  human(actor)
  const dashboard = await saved(env, id)
  insist(manages(actor, dashboard), 'forbidden', 403)
  const shares = await all(env, `SELECT s.id, s.viewer_id AS viewer, m.name AS viewerName, s.kind, s.expires_at AS expiresAt, s.revoked_at AS revokedAt, s.restored_at AS restoredAt
    FROM beam_dashboard_shares s JOIN beam_members m ON m.id = s.viewer_id WHERE dashboard_id = ? ORDER BY granted_at DESC`, id)
  return { dashboard, shares }
}

export function dashboardCsv(report: Awaited<ReturnType<typeof readDashboard>>) {
  const definitions = [new Date(report.asOf).toISOString(), 'Live data; not a snapshot', JSON.stringify(report.filters)]
  const dateValue = (field: DashboardField, value: unknown) => ['due', 'completedAt'].includes(field) && value ? new Date(Number(value)).toISOString() : value
  return [[...report.fields.map(field => DASHBOARD_LABELS[field]), 'As of (UTC)', 'Data', 'Saved filters'],
    ...(report.rows.length ? report.rows.map(row => [...report.fields.map(field => dateValue(field, row[field])), ...definitions]) : [[...report.fields.map(() => ''), definitions[0], 'Live data; no matching rows', definitions[2]]])].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
