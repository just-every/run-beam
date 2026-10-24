import { refuseErasedIdentity } from './erasure-fence'
// ORG-006: bulk people changes with a write-free preview. The owner, or a learning administrator for their units'
// people, uploads a CSV or XLSX roster; Beam maps its columns by header name (each mapping can be changed) and keeps the
// file as a batch with one planned action per row: create (and invite, when chosen, a new person with a work email),
// update, transfer (a changed role, department or location, or a new team), deactivate (the row's employment is
// terminated: the person is marked as left and their access ends), unchanged, a held conflict (ORG-001), or an error
// (no email and no employee id, an email, employee id or username repeated in the file, a manager employee id found
// neither in Beam nor in the file, an unknown team, a username someone else holds, invalid values, outside the
// administrator's units). People missing from the file stay as they are unless the uploader explicitly chooses to
// deactivate them; that policy, like any deactivation, is the owner's, and it reaches only people with an employee id,
// never the owner or the uploader. The preview writes nothing to people, access or mail. Apply takes the selected
// rows in file order, at most CHUNK per request, re-checks each against the directory (a row whose action changed
// since the preview is skipped and says so), records each row's outcome, and resumes where it stopped: a row is
// claimed before its person is written and an invitation is sent only to someone with no sign-in account yet, so a
// resumed or repeated apply never invites anyone twice. Base sends at most 30 invitations from one address in 15
// minutes: a new person whose invitation meets that limit is added and their invitation waits on the row, labelled as
// waiting, until a later apply sends it. Managers are linked once every person is in. Email-less rows
// keep a username and mobile number and are never emailed; their sign-in and first-sign-in sheets are ORG-011's.
import { operatorAuth, type Bindings } from '../auth.server'
import type { Actor } from './actor'
import { BeamError, all, commit, insist, newId, now, one, stmt, type Row } from './core'
import { COLUMNS, addPerson, administers, applyValues, check, directoryFields, holdConflict, joinTeam, key, type Person, type Values } from './directory'
import type { Input } from './input'
import { readCsv, readXlsx } from './movein/tables'
import { normalizeEmail } from '../modules/operator-auth/index.mjs'
import { changeAccess } from './people'

export const CHUNK = 50
const APPLY = ['create', 'update', 'transfer', 'deactivate', 'deactivate_missing', 'conflict']
const MOVES = ['jobRole', 'department', 'location'] as const
type Target = string | null
interface Context { mapping: Target[]; fields: string[]; emails: Map<string, number>; ids: Map<string, number>; usernames: Map<string, number>; teams: Map<string, { id: string; unit_id: string | null }>; invite: boolean }
interface Planned { action: string; member: string | null; name: string; changes: string[]; errors: string[]; invite: boolean; values: Values; managerEmployeeId: string; team: { id: string; unit_id: string | null } | null; username: string | null }

const requireAdministrator = (actor: Actor) => insist(!actor.agent && !actor.viewAs && (actor.owner || actor.adminUnits.length > 0), 'owner_required', 403)
/** The normalized address, or null when it is not one (Base's normalizer throws). */
const address = (value: string) => { try { return normalizeEmail(value) || null } catch { return null } }
const STATUS: Record<string, string> = { active: 'active', leave: 'leave', 'on leave': 'leave', terminated: 'terminated', inactive: 'terminated', deactivated: 'terminated', left: 'terminated' }

/** The row's values under the mapping; a blank cell keeps what is stored, as in ORG-001's import. */
function read(context: Context, cells: string[]) {
  const values: Values = {}, custom: Record<string, string | null> = {}
  let managerEmployeeId = '', team = '', username = ''
  context.mapping.forEach((target, index) => {
    const value = (cells[index] ?? '').trim()
    if (!target || !value) return
    if (target === 'managerEmployeeId') managerEmployeeId = value
    else if (target === 'team') team = value
    else if (target === 'username') username = value.toLowerCase()
    else if (target === 'employment') values.employment = (STATUS[value.toLowerCase()] ?? value.toLowerCase()) as Values['employment']
    else if (target === 'email') values.email = address(value) ?? `invalid:${value}`
    else if (context.fields.includes(target)) custom[target] = value
    else (values as Record<string, unknown>)[target] = value
  })
  if (Object.keys(custom).length) values.custom = custom
  return { values, managerEmployeeId, team, username }
}

/** What applying one row would do now, without writing anything. */
async function plan(env: Bindings, actor: Actor, context: Context, cells: string[]): Promise<Planned> {
  const { values, managerEmployeeId, team: teamName, username } = read(context, cells)
  const errors: string[] = []
  if (values.email?.startsWith('invalid:')) { errors.push('invalid_email'); delete values.email }
  try { check(values) } catch (error) { if (!(error instanceof BeamError)) throw error; errors.push(error.message) }
  if (!values.email && !values.employeeId) errors.push('missing_identity')
  if (values.email && (context.emails.get(values.email) ?? 0) > 1) errors.push('duplicate_email')
  if (values.employeeId && (context.ids.get(values.employeeId) ?? 0) > 1) errors.push('duplicate_employee_id')
  if (username && !/^[a-z0-9._-]{3,40}$/.test(username)) errors.push('invalid_username')
  if (username && (context.usernames.get(username) ?? 0) > 1) errors.push('duplicate_username')
  const team = teamName ? context.teams.get(teamName.toLowerCase()) ?? null : null
  if (teamName && !team) errors.push('team_not_found')
  if (managerEmployeeId && (managerEmployeeId === values.employeeId || (!context.ids.has(managerEmployeeId) && !await one(env, 'SELECT 1 FROM beam_members WHERE employee_id = ?', managerEmployeeId)))) errors.push('invalid_manager')
  const holder = values.employeeId ? await one<Person>(env, 'SELECT * FROM beam_members WHERE employee_id = ?', values.employeeId) : null
  const byEmail = values.email ? await one<Person>(env, 'SELECT * FROM beam_members WHERE email = ?', values.email) : null
  const other = byEmail && byEmail.id !== holder?.id && (holder || byEmail.employee_id) ? byEmail : null
  const target = other ? null : holder ?? byEmail
  if (username && await one(env, 'SELECT 1 FROM beam_members WHERE username = ? AND id IS NOT ?', username, target?.id ?? null)) errors.push('username_in_use')
  const base = { member: target?.id ?? other?.id ?? null, name: values.name ?? target?.name ?? '', values, managerEmployeeId, team, username: username || null, invite: false, changes: [] as string[] }
  if (target ? !(actor.owner || await administers(env, actor, target.id)) : !(actor.owner || (team && actor.adminUnits.includes(team.unit_id ?? '')))) errors.push('outside_your_units')
  if (!errors.length && other) return { ...base, action: values.employeeId ? 'conflict' : 'error', errors: values.employeeId ? [] : ['email_has_other_employee_id'] }
  if (!target) {
    if (!values.name) errors.push('missing_name')
    if (values.employment === 'terminated') errors.push('not_employed')
    return { ...base, action: errors.length ? 'error' : 'create', errors, invite: !errors.length && context.invite && !!values.email, changes: [] }
  }
  const current: Record<string, unknown> = { employeeId: target.employee_id, name: target.name, email: target.email, mobile: target.mobile, employment: target.employment, hireDate: target.hire_date, transferDate: target.transfer_date, preferredName: target.preferred_name, language: target.language, jobRole: target.job_role, department: target.department, location: target.location, timeZone: target.time_zone }
  const stored = JSON.parse(target.custom_json) as Record<string, string>
  const changes = Object.entries(values).filter(([name, value]) => name !== 'custom' && value !== current[name]).map(([name]) => name)
  for (const [field, value] of Object.entries(values.custom ?? {})) if ((stored[field] ?? null) !== value) changes.push(`custom:${field}`)
  if (username && username !== target.username) changes.push('username')
  const manager = managerEmployeeId ? await one<{ id: string }>(env, 'SELECT id FROM beam_members WHERE employee_id = ?', managerEmployeeId) : null
  if (managerEmployeeId && manager?.id !== target.manager_id) changes.push('manager')
  const joins = team && !await one(env, 'SELECT 1 FROM beam_team_members WHERE team_id = ? AND member_id = ?', team.id, target.id)
  if (joins) changes.push('team')
  const leaving = values.employment === 'terminated' && target.employment !== 'terminated'
  if (leaving && !actor.owner) errors.push('owner_required')
  if (errors.length) return { ...base, action: 'error', errors, changes }
  const moved = joins || MOVES.some(name => values[name] !== undefined && current[name] !== null && values[name] !== current[name])
  return { ...base, errors, changes, action: leaving ? 'deactivate' : moved ? 'transfer' : changes.length ? 'update' : 'unchanged' }
}

async function context(env: Bindings, mapping: Target[], lines: string[][], invite: boolean): Promise<Context> {
  const fields = (await directoryFields(env)).map(field => field.id)
  const teams = new Map((await all<{ id: string; name: string; unit_id: string | null }>(env, 'SELECT id, name, unit_id FROM beam_teams')).map(team => [team.name.toLowerCase(), { id: team.id, unit_id: team.unit_id }]))
  const tally = (target: string, normalize = (value: string) => value) => {
    const counts = new Map<string, number>(), index = mapping.indexOf(target)
    if (index >= 0) for (const cells of lines) { const value = normalize((cells[index] ?? '').trim()); if (value) counts.set(value, (counts.get(value) ?? 0) + 1) }
    return counts
  }
  return { mapping, fields, teams, invite, emails: tally('email', value => address(value) ?? value), ids: tally('employeeId'), usernames: tally('username', value => value.toLowerCase()) }
}

/** People with an employee id who are not in the file: the targets of the explicit "deactivate missing" policy. */
async function missingPeople(env: Bindings, actor: Actor, context: Context, lines: string[][]) {
  const seen = new Set<string>()
  for (const cells of lines) {
    const { values } = read(context, cells)
    const person = values.email?.startsWith('invalid:') ? null : values.employeeId ? await one<{ id: string }>(env, 'SELECT id FROM beam_members WHERE employee_id = ?', values.employeeId) : values.email ? await one<{ id: string }>(env, 'SELECT id FROM beam_members WHERE email = ?', values.email) : null
    if (person) seen.add(person.id)
  }
  return (await all<{ id: string; name: string }>(env, "SELECT id, name FROM beam_members WHERE employee_id IS NOT NULL AND employment <> 'terminated' AND id <> ? AND (operator_id IS NULL OR operator_id NOT IN (SELECT id FROM oa_operators WHERE role = 'owner')) ORDER BY name", actor.id))
    .filter(person => !seen.has(person.id))
}

async function rowsOf(env: Bindings, batch: string) {
  return await all<{ seq: number; line: number | null; cells_json: string; action: string; detail_json: string; member_id: string | null; state: string; outcome: string | null }>(env, 'SELECT * FROM beam_roster_batch_rows WHERE batch_id = ? ORDER BY seq', batch)
}

async function requireBatch(env: Bindings, actor: Actor, id: string) {
  requireAdministrator(actor)
  const batch = await one(env, 'SELECT * FROM beam_roster_batches WHERE id = ?', id)
  insist(batch && (actor.owner || batch.created_by === actor.id), 'batch_not_found', 404)
  return batch
}

/** Upload (a new batch) or re-map an unapplied batch, and plan every row. Nothing about people, access or mail changes. */
export async function previewBatch(env: Bindings, actor: Actor, input: Input) {
  requireAdministrator(actor)
  const existing = input.text('batch', { optional: true, max: 64 })
  let headers: string[], lines: string[][], filename: string, previous: Target[] = []
  if (existing) {
    const batch = await requireBatch(env, actor, existing)
    insist(batch.state === 'preview', 'batch_applied', 409)
    if (await one(env, 'SELECT 1 FROM beam_roster_feed_receipts WHERE batch_id=?', existing)) {
      insist(!input.flag('invite'), 'feed_invitations_forbidden', 409)
    }
    headers = JSON.parse(batch.headers_json); previous = JSON.parse(batch.mapping_json); filename = batch.filename
    lines = (await rowsOf(env, existing)).filter(row => row.line !== null).map(row => JSON.parse(row.cells_json))
  } else {
    const file = await input.file('file', { maxBytes: 5_000_000 })
    filename = file!.filename
    const xlsx = file!.bytes[0] === 0x50 && file!.bytes[1] === 0x4b
    const rows = xlsx ? (await readXlsx(file!.bytes))[0]?.rows ?? [] : readCsv(file!.bytes).rows;
    [headers = [], ...lines] = rows
    insist(headers.length > 0 && lines.length > 0 && lines.length <= 5000, 'roster_empty')
  }
  const fields = await directoryFields(env)
  const targets = new Set<string>([...Object.values(COLUMNS), ...fields.map(field => field.id)])
  const mapping = headers.map((header, index) => {
    if (input.has(`map_${index}`)) { const chosen = input.text(`map_${index}`, { max: 64 }); insist(chosen === 'ignore' || targets.has(chosen), 'invalid_mapping'); return chosen === 'ignore' ? null : chosen }
    return previous[index] !== undefined ? previous[index] : COLUMNS[key(header)] ?? fields.find(field => key(field.label) === key(header))?.id ?? null
  })
  insist(mapping.includes('employeeId') || mapping.includes('email'), 'roster_headers', 400, { needs: ['Employee ID or Email'] })
  insist(new Set(mapping.filter(Boolean)).size === mapping.filter(Boolean).length, 'mapping_repeated')
  const invite = input.flag('invite'), missing = input.text('missing', { optional: true, max: 20 }) || 'keep'
  insist(missing === 'keep' || missing === 'deactivate', 'invalid_missing_policy')
  insist(missing === 'keep' || actor.owner, 'owner_required', 403)
  for (const cells of lines) await refuseErasedIdentity(env, cells)
  const ctx = await context(env, mapping, lines, invite)
  const planned: Row[] = []
  for (const [index, cells] of lines.entries()) {
    const row = await plan(env, actor, ctx, cells)
    planned.push({ seq: index + 1, line: index + 2, cells, action: row.action, member: row.member, detail: { name: row.name, changes: row.changes, errors: row.errors, invite: row.invite, username: row.username } })
  }
  if (missing === 'deactivate') for (const person of await missingPeople(env, actor, ctx, lines))
    planned.push({ seq: planned.length + 1, line: null, cells: [], action: 'deactivate_missing', member: person.id, detail: { name: person.name, changes: ['employment'], errors: [], invite: false, username: null } })
  const id = existing || newId(), at = now()
  const statements = [existing
    ? stmt(env, 'UPDATE beam_roster_batches SET mapping_json = ?, invite = ?, missing = ?, previewed_at = ? WHERE id = ?', JSON.stringify(mapping), invite ? 1 : 0, missing, at, id)
    : stmt(env, "INSERT INTO beam_roster_batches (id, filename, headers_json, mapping_json, invite, missing, state, created_by, created_at, previewed_at) VALUES (?, ?, ?, ?, ?, ?, 'preview', ?, ?, ?)", id, filename, JSON.stringify(headers), JSON.stringify(mapping), invite ? 1 : 0, missing, actor.id, at, at),
  stmt(env, 'DELETE FROM beam_roster_batch_rows WHERE batch_id = ?', id),
  ...planned.map(row => stmt(env, "INSERT INTO beam_roster_batch_rows (batch_id, seq, line, cells_json, action, detail_json, member_id, state) VALUES (?, ?, ?, ?, ?, ?, ?, 'planned')", id, row.seq, row.line, JSON.stringify(row.cells), row.action, JSON.stringify(row.detail), row.member))]
  for (let start = 0; start < statements.length; start += 500) await env.DB.batch(statements.slice(start, start + 500))
  const counts = tally(planned.map(row => row.action))
  await commit(env, [], { actor, action: 'roster.preview', subject: id, detail: { filename, counts, invite, missing } })
  return { id, headers, mapping, counts, rows: planned.map(({ cells, ...row }) => row) }
}

const tally = (values: string[]) => values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {})

/** Applies the selected rows, at most `limit` (CHUNK) per request; call again to resume. A finished batch applies nothing. */
export async function applyBatch(env: Bindings, request: Request, actor: Actor, input: Input) {
  const batch = await requireBatch(env, actor, input.text('batch', { max: 64 }))
  if (batch.state === 'applied') return { id: batch.id, applied: 0, remaining: 0, done: true, alreadyApplied: true }
  insist(batch.missing === 'keep' || actor.owner, 'owner_required', 403)
  if (batch.state === 'preview') {
    // The first apply fixes the selection (every applicable row unless rows are named); the rest are closed as shown.
    const selected = input.has('rows') ? new Set(input.list('rows').map(Number)) : null
    const close = (await rowsOf(env, batch.id)).filter(row => !APPLY.includes(row.action) || (selected && !selected.has(row.seq)))
    await env.DB.batch([stmt(env, "UPDATE beam_roster_batches SET state = 'applying' WHERE id = ? AND state = 'preview'", batch.id),
      ...close.map(row => stmt(env, "UPDATE beam_roster_batch_rows SET state = 'done', outcome = ? WHERE batch_id = ? AND seq = ?", APPLY.includes(row.action) ? 'not_selected' : row.action, batch.id, row.seq))])
  }
  const limit = input.integer('limit', { min: 1, max: CHUNK, optional: true }) ?? CHUNK
  const rows = await rowsOf(env, batch.id)
  const lines = rows.filter(row => row.line !== null).map(row => JSON.parse(row.cells_json) as string[])
  const ctx = await context(env, JSON.parse(batch.mapping_json), lines, batch.invite === 1)
  const outcomes: string[] = [], gate = { limited: false }
  for (const row of rows.filter(item => item.state !== 'done').slice(0, limit)) outcomes.push(await applyRow(env, request, actor, ctx, gate, batch.id, row))
  const left = (await one<{ n: number; waiting: number; planned: number }>(env, "SELECT COUNT(*) AS n, COALESCE(SUM(outcome = 'invitation_waiting'), 0) AS waiting, COALESCE(SUM(state = 'planned'), 0) AS planned FROM beam_roster_batch_rows WHERE batch_id = ? AND state <> 'done'", batch.id))!
  const remaining = left.n
  if (!left.planned) await linkManagers(env, request, actor, ctx, batch.id)
  if (!remaining) await commit(env, [stmt(env, "UPDATE beam_roster_batches SET state = 'applied', applied_at = ? WHERE id = ?", now(), batch.id)],
    { actor, action: 'roster.apply', subject: batch.id, detail: { outcomes: tally((await rowsOf(env, batch.id)).map(item => item.outcome ?? '')) } })
  return { id: batch.id, applied: outcomes.length, outcomes: tally(outcomes), remaining, invitationsWaiting: left.waiting, done: !remaining }
}

async function finish(env: Bindings, batch: string, seq: number, outcome: string, member: string | null) {
  await env.DB.prepare("UPDATE beam_roster_batch_rows SET state = 'done', outcome = ?, member_id = COALESCE(?, member_id), applied_at = ? WHERE batch_id = ? AND seq = ?").bind(outcome, member, now(), batch, seq).run()
  return outcome
}

/** Sends one invitation: 'sent', 'none' (no email, or already has a sign-in account) or 'waiting' (Base's sending limit). */
async function invite(env: Bindings, request: Request, actor: Actor, memberId: string, gate: { limited: boolean }): Promise<'sent' | 'none' | 'waiting'> {
  const person = await one<{ email: string | null; name: string; operator_id: string | null }>(env, 'SELECT email, name, operator_id FROM beam_members WHERE id = ?', memberId)
  // Someone who already has a sign-in account (an earlier, interrupted apply invited them) is never invited again.
  if (!person?.email || person.operator_id) return 'none'
  if (gate.limited) return 'waiting'
  try { await operatorAuth(env).invite(request, { email: person.email, displayName: person.name, role: 'member', returnTo: '/app' }) } catch (error) {
    if ((error as { code?: string }).code !== 'rate_limited') throw error
    gate.limited = true
    return 'waiting'
  }
  await commit(env, [stmt(env, 'UPDATE beam_members SET operator_id = (SELECT id FROM oa_operators WHERE lower(email) = ?) WHERE id = ?', person.email, memberId)], { actor, action: 'person.invite', subject: memberId, detail: { email: person.email, roster: true } })
  return 'sent'
}

/** The create row's ending: invited, added, or (invitation waiting) left open for the next apply. */
async function invited(env: Bindings, batch: string, seq: number, member: string, result: 'sent' | 'none' | 'waiting') {
  if (result !== 'waiting') return finish(env, batch, seq, result === 'sent' ? 'created_invited' : 'created', member)
  await env.DB.prepare("UPDATE beam_roster_batch_rows SET outcome = 'invitation_waiting' WHERE batch_id = ? AND seq = ?").bind(batch, seq).run()
  return 'invitation_waiting'
}

async function applyRow(env: Bindings, request: Request, actor: Actor, ctx: Context, gate: { limited: boolean }, batch: string, row: { seq: number; line: number | null; cells_json: string; action: string; detail_json: string; member_id: string | null; state: string }) {
  if (row.state === 'applying' && row.member_id && row.action === 'create') {
    // Interrupted after the person was written: finish the invitation step only.
    return invited(env, batch, row.seq, row.member_id, JSON.parse(row.detail_json).invite ? await invite(env, request, actor, row.member_id, gate) : 'none')
  }
  if (row.action === 'deactivate_missing') return finish(env, batch, row.seq, await deactivate(env, request, actor, row.member_id!) ? 'deactivated' : 'unchanged', row.member_id)
  const fresh = await plan(env, actor, ctx, JSON.parse(row.cells_json))
  if (fresh.action !== row.action) return finish(env, batch, row.seq, 'changed_since_preview', null)
  const values = { ...fresh.values }
  if (row.action === 'conflict') {
    await holdConflict(env, actor, { values: values as Values & { employeeId: string }, managerEmployeeId: fresh.managerEmployeeId, team: fresh.team?.id ?? null, holder: (await one<{ id: string }>(env, 'SELECT id FROM beam_members WHERE employee_id = ?', values.employeeId))?.id ?? null, other: fresh.member!, line: row.line! })
    return finish(env, batch, row.seq, 'held', fresh.member)
  }
  if (row.action === 'create') {
    const id = await addPerson(env, request, actor, values, fresh.team ?? undefined)
    await env.DB.batch([stmt(env, "UPDATE beam_roster_batch_rows SET state = 'applying', member_id = ? WHERE batch_id = ? AND seq = ?", id, batch, row.seq), stmt(env, 'UPDATE beam_members SET username = ? WHERE id = ?', fresh.username, id)])
    return invited(env, batch, row.seq, id, fresh.invite ? await invite(env, request, actor, id, gate) : 'none')
  }
  const person = (await one<Person>(env, 'SELECT * FROM beam_members WHERE id = ?', fresh.member))!
  if (row.action === 'deactivate') {
    await applyValues(env, request, actor, person, { ...values, employment: undefined })
    await deactivate(env, request, actor, person.id)
    return finish(env, batch, row.seq, 'deactivated', person.id)
  }
  await applyValues(env, request, actor, person, values)
  if (fresh.username) await env.DB.prepare('UPDATE beam_members SET username = ? WHERE id = ?').bind(fresh.username, person.id).run()
  if (fresh.team) await joinTeam(env, actor, person.id, fresh.team)
  return finish(env, batch, row.seq, row.action === 'transfer' ? 'transferred' : 'updated', person.id)
}

/** Marks the person as left and ends their access (sessions end); their records stay. */
async function deactivate(env: Bindings, request: Request, actor: Actor, memberId: string) {
  const person = (await one<Person>(env, 'SELECT * FROM beam_members WHERE id = ?', memberId))!
  if (person.employment === 'terminated') return false
  await applyValues(env, request, actor, person, { employment: 'terminated' })
  if (await one(env, "SELECT 1 FROM oa_operators WHERE id = ? AND status = 'active'", person.operator_id)) await changeAccess(env, request, actor, person.id, 'inactive', { roster: true })
  return true
}

/** Once every row is in, each row's manager employee id is linked (a manager may appear further down the file). */
async function linkManagers(env: Bindings, request: Request, actor: Actor, ctx: Context, batch: string) {
  for (const row of await rowsOf(env, batch)) {
    if (!row.member_id || !['created', 'created_invited', 'invitation_waiting', 'updated', 'transferred'].includes(row.outcome ?? '')) continue
    const { managerEmployeeId } = read(ctx, JSON.parse(row.cells_json))
    const manager = managerEmployeeId ? await one<{ id: string }>(env, 'SELECT id FROM beam_members WHERE employee_id = ?', managerEmployeeId) : null
    if (manager && manager.id !== row.member_id) await applyValues(env, request, actor, (await one<Person>(env, 'SELECT * FROM beam_members WHERE id = ?', row.member_id))!, { manager: manager.id })
  }
}

/** The uploader's (or, for the owner, every) batch not yet applied, and recent applied ones, with their rows. */
export async function batchesView(env: Bindings, actor: Actor) {
  requireAdministrator(actor)
  const batches = await all(env, "SELECT id, filename, headers_json, mapping_json, invite, missing, state, created_at AS createdAt, previewed_at AS previewedAt, applied_at AS appliedAt FROM beam_roster_batches WHERE (? = 1 OR created_by = ?) ORDER BY created_at DESC LIMIT 5", actor.owner ? 1 : 0, actor.id)
  const result = []
  for (const { headers_json, mapping_json, ...batch } of batches) {
    const rows = (await rowsOf(env, batch.id)).map(row => ({ seq: row.seq, line: row.line, action: row.action, member: row.member_id, state: row.state, outcome: row.outcome, ...JSON.parse(row.detail_json) }))
    result.push({ ...batch, invite: batch.invite === 1, headers: JSON.parse(headers_json), mapping: JSON.parse(mapping_json), counts: tally(rows.map(row => row.action)), remaining: rows.filter(row => row.state !== 'done').length, waiting: rows.filter(row => row.outcome === 'invitation_waiting').length, rows } as Row)
  }
  return { batches: result }
}
