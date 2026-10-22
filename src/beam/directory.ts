import { refuseErasedIdentity } from './erasure-fence'
// ORG-001: the employee learning directory. Each person carries a stable employee id, preferred name, an optional work
// email, mobile number, preferred language, employment state, manager, job role, department, location, hire date and
// the owner's custom fields. Who reads what (ct, 19 Oct 08:48Z): the owner reads and edits everyone; a unit's learning
// administrator (ORG-002) the people in their units' teams; a manager (ORG-004) reads the people in their own teams
// without mobile number, hire date or custom fields (save a custom field whose "managers may read" switch is on) and
// edits nothing; the person reads their own record; everyone else sees the name only. The audit (OPS-001) keeps which
// fields changed and the employee id, never a mobile number or a custom field's value.
import { operatorAuth, type Bindings } from '../auth.server'
import { normalizeEmail } from '../modules/operator-auth/index.mjs'
import { requireOwner, type Actor } from './actor'
import { BeamError, all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { requireBusiness } from './people'
import { localDate, validTimezone } from './time'

export const EMPLOYMENT = ['active', 'leave', 'terminated'] as const
type Employment = typeof EMPLOYMENT[number]
/** The fields a manager reads for people in their own teams. */
const MANAGER_FIELDS = ['employeeId', 'name', 'preferredName', 'email', 'language', 'employment', 'manager', 'jobRole', 'department', 'location'] as const
const TEXT_FIELDS = { preferredName: 'preferred_name', mobile: 'mobile', language: 'language', jobRole: 'job_role', department: 'department', location: 'location', timeZone: 'time_zone' } as const
type TextField = keyof typeof TEXT_FIELDS
const LABELS: Record<string, string> = { employeeId: 'employee id', name: 'name', preferredName: 'preferred name', email: 'work email', mobile: 'mobile number', language: 'preferred language', employment: 'employment state', manager: 'manager', jobRole: 'role', department: 'department', location: 'location', hireDate: 'hire date', transferDate: 'transfer date', timeZone: 'time zone' }

export interface Person { id: string; name: string; email: string | null; operator_id: string | null; employee_id: string | null; preferred_name: string | null; mobile: string | null; language: string | null; employment: Employment; manager_id: string | null; job_role: string | null; department: string | null; location: string | null; hire_date: string | null; transfer_date: string | null; custom_json: string; username: string | null; time_zone: string | null }
/** One person's directory values, as an edit or a roster row gives them; absent keys stay as they are. */
export interface Values { employeeId?: string | null; name?: string; email?: string | null; mobile?: string | null; employment?: Employment; manager?: string | null; hireDate?: string | null; transferDate?: string | null; custom?: Record<string, string | null>; preferredName?: string | null; language?: string | null; jobRole?: string | null; department?: string | null; location?: string | null; timeZone?: string | null }

export async function directoryFields(env: Bindings) {
  return await all<{ id: string; label: string; managersRead: number }>(env, 'SELECT id, label, managers_read AS managersRead FROM beam_directory_fields ORDER BY label')
}

/** The owner defines a custom field, or with `field` renames it and sets whether managers may read it (off by default). */
export async function saveDirectoryField(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const label = input.text('label', { max: 60 }), managersRead = input.flag('managersRead') ? 1 : 0, existing = input.text('field', { optional: true })
  insist(!await one(env, 'SELECT 1 FROM beam_directory_fields WHERE label = ? AND id IS NOT ?', label, existing || null), 'field_exists', 409)
  const id = existing || newId()
  if (existing) insist(await one(env, 'SELECT 1 FROM beam_directory_fields WHERE id = ?', existing), 'field_not_found', 404)
  await commit(env, [existing ? stmt(env, 'UPDATE beam_directory_fields SET label = ?, managers_read = ? WHERE id = ?', label, managersRead, id) : stmt(env, 'INSERT INTO beam_directory_fields (id, label, managers_read, created_at) VALUES (?, ?, ?, ?)', id, label, managersRead, now())],
    { actor, action: 'person.field', subject: id, detail: { label, managersRead: !!managersRead } })
  return { id, label, managersRead: !!managersRead }
}

/** 'full' for the owner, the person themself and a learning administrator of one of their units' teams; 'manager' for a
 * manager of one of their teams; 'none' for everyone else. */
async function readAccess(env: Bindings, actor: Actor, memberId: string): Promise<'full' | 'manager' | 'none'> {
  if (actor.owner || actor.id === memberId || await administers(env, actor, memberId)) return 'full'
  if (actor.managedTeams.length && await one(env, 'SELECT 1 FROM beam_team_members WHERE member_id = ? AND team_id IN (SELECT value FROM json_each(?))', memberId, JSON.stringify(actor.managedTeams))) return 'manager'
  return 'none'
}

export const administers = async (env: Bindings, actor: Actor, memberId: string) => actor.adminUnits.length > 0 && !actor.agent
  && !!await one(env, 'SELECT 1 FROM beam_team_members tm JOIN beam_teams t ON t.id = tm.team_id WHERE tm.member_id = ? AND t.unit_id IN (SELECT value FROM json_each(?))', memberId, JSON.stringify(actor.adminUnits))

/** Edits: the owner, or a learning administrator for people in their units' teams; never the person themself or an agent. */
export async function requireEditor(env: Bindings, actor: Actor, memberId: string) {
  insist(!actor.agent && !actor.viewAs, 'forbidden', 403)
  insist(actor.owner || await administers(env, actor, memberId), actor.adminUnits.length ? 'outside_your_units' : 'owner_required', 403)
}

/** One person's directory record as this reader may see it, with its change history for full readers; 404 for no access. */
export async function personDirectory(env: Bindings, actor: Actor, memberId: string) {
  const person = await one<Person>(env, 'SELECT * FROM beam_members WHERE id = ?', memberId)
  const access = person ? await readAccess(env, actor, memberId) : 'none'
  if (!person || access === 'none') throw new BeamError('not_found', 404)
  const fields = await directoryFields(env)
  const custom = JSON.parse(person.custom_json) as Record<string, string>
  const manager = person.manager_id ? await one<{ id: string; name: string; employee_id: string | null }>(env, 'SELECT id, name, employee_id FROM beam_members WHERE id = ?', person.manager_id) : null
  const account = person.operator_id ? await one<{ email: string; status: string }>(env, 'SELECT lower(email) AS email, status FROM oa_operators WHERE id = ?', person.operator_id) : null
  const record: Row = {
    id: person.id, employeeId: person.employee_id, name: person.name, preferredName: person.preferred_name, email: person.email, mobile: person.mobile, language: person.language,
    employment: person.employment, manager: manager && { id: manager.id, name: manager.name, employeeId: manager.employee_id }, jobRole: person.job_role, department: person.department,
    location: person.location, hireDate: person.hire_date, transferDate: person.transfer_date, username: person.username, timeZone: person.time_zone,
    custom: fields.filter(field => access === 'full' || field.managersRead).map(field => ({ id: field.id, label: field.label, value: custom[field.id] ?? null })),
  }
  if (access === 'manager') for (const key of Object.keys(record)) if (!['id', 'custom', ...MANAGER_FIELDS].includes(key)) delete record[key]
  if (access !== 'full') return { access, editable: false, person: record }
  // The sign-in email changes only when the person changes it themself after verifying it (Base's rule).
  const signIn = account ? { email: account.email, status: account.status, matches: account.email === person.email } : null
  const history = await all<{ at: number; action: string; actorName: string | null; detail: string }>(env, "SELECT a.at, a.action, m.name AS actorName, a.detail FROM beam_audit a LEFT JOIN beam_members m ON m.id = a.actor WHERE a.subject = ? AND a.action LIKE 'person.%' ORDER BY a.id DESC LIMIT 100", memberId)
  return { access, editable: actor.owner || await administers(env, actor, memberId), person: record, signIn, history: history.map(row => ({ ...row, detail: JSON.parse(row.detail) })) }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const validDate = (value: string) => DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

/** Reads the directory values an edit form or JSON body gives; a field that is not sent stays as it is. */
async function valuesFrom(env: Bindings, input: Input): Promise<Values> {
  const values: Values = {}
  const optional = (name: string, max: number) => input.text(name, { max, optional: true }) || null
  if (input.has('employeeId') || input.has('employeeIdSent')) values.employeeId = optional('employeeId', 40)
  if (input.has('name')) values.name = input.text('name', { max: 120 })
  for (const key of Object.keys(TEXT_FIELDS) as TextField[]) if (input.has(key) || input.has(`${key}Sent`)) values[key] = optional(key, key === 'mobile' ? 30 : 80)
  if (input.has('email') || input.has('emailSent')) values.email = optional('email', 254)
  if (input.has('employment')) values.employment = input.text('employment') as Employment
  if (input.has('manager') || input.has('managerSent')) values.manager = optional('manager', 64)
  if (input.has('hireDate') || input.has('hireDateSent')) values.hireDate = optional('hireDate', 10)
  if (input.has('transferDate') || input.has('transferDateSent')) values.transferDate = optional('transferDate', 10)
  const custom: Record<string, string | null> = {}
  for (const field of await directoryFields(env)) if (input.has(`custom_${field.id}`) || input.has(`custom_${field.id}Sent`)) custom[field.id] = optional(`custom_${field.id}`, 200)
  if (Object.keys(custom).length) values.custom = custom
  return values
}

/** People › a person › Edit directory: the owner, or a learning administrator for their units' people. An employee id
 * another person holds is refused (409); nothing is merged. */
export async function editDirectory(env: Bindings, request: Request, actor: Actor, input: Input) {
  const memberId = input.text('member', { max: 64 })
  await requireEditor(env, actor, memberId)
  const person = await one<Person>(env, 'SELECT * FROM beam_members WHERE id = ?', memberId)
  insist(person, 'person_not_found', 404)
  const values = await valuesFrom(env, input)
  if (values.employeeId) insist(!await one(env, 'SELECT 1 FROM beam_members WHERE employee_id = ? AND id <> ?', values.employeeId, memberId), 'employee_id_in_use', 409, { employeeId: values.employeeId })
  return await applyValues(env, request, actor, person, values)
}

export function check(values: Values) {
  if (values.email !== undefined && values.email !== null) { values.email = normalizeEmail(values.email); insist(values.email, 'invalid_email') }
  if (values.employment !== undefined) insist((EMPLOYMENT as readonly string[]).includes(values.employment), 'invalid_employment')
  if (values.hireDate) insist(validDate(values.hireDate), 'invalid_hire_date')
  if (values.transferDate) insist(validDate(values.transferDate), 'invalid_transfer_date')
  if (values.timeZone) insist(validTimezone(values.timeZone), 'invalid_timezone')
  if (values.mobile) insist(/^\+?[0-9 ().-]{7,30}$/.test(values.mobile) && values.mobile.replace(/\D/g, '').length >= 7, 'invalid_mobile')
  if (values.employeeId !== undefined && values.employeeId !== null) insist(/^[\w.-]{1,40}$/.test(values.employeeId), 'invalid_employee_id')
}

/** Writes one person's changed values in one audited batch. A work email change on someone whose invitation is still
 * unused re-sends it to the new address; for someone who has signed in, only the directory email changes. A change of
 * a role, department or location the person already had is a transfer (AUTO-001): unless the edit or row gives a
 * transfer date, it is today in the business time zone. */
export async function applyValues(env: Bindings, request: Request, actor: Actor, person: Person, given: Values) {
  insist(!await one(env, 'SELECT 1 FROM beam_members WHERE id=? AND (erasure_pending=1 OR erased_at IS NOT NULL)', person.id), 'erased_identity', 409)
  await refuseErasedIdentity(env, [given.email, given.employeeId])
  const values = Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined)) as Values
  check(values)
  if (values.manager) {
    insist(values.manager !== person.id, 'invalid_manager')
    insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', values.manager), 'manager_not_found', 404)
  }
  if (values.email) insist(!await one(env, 'SELECT 1 FROM beam_members WHERE email = ? AND id <> ?', values.email, person.id), 'email_in_use', 409, { email: values.email })
  const current: Record<string, unknown> = { employeeId: person.employee_id, name: person.name, email: person.email, mobile: person.mobile, employment: person.employment, manager: person.manager_id, hireDate: person.hire_date, transferDate: person.transfer_date, preferredName: person.preferred_name, language: person.language, jobRole: person.job_role, department: person.department, location: person.location, timeZone: person.time_zone }
  if (values.transferDate === undefined && (['jobRole', 'department', 'location'] as const).some(key => values[key] !== undefined && current[key] !== null && values[key] !== current[key]))
    values.transferDate = localDate(now(), (await requireBusiness(env)).timezone)
  const changed = Object.keys(values).filter(key => key !== 'custom' && (values as Record<string, unknown>)[key] !== current[key])
  const custom = JSON.parse(person.custom_json) as Record<string, string>
  const customChanged = Object.entries(values.custom ?? {}).filter(([id, value]) => (custom[id] ?? null) !== value).map(([id]) => id)
  for (const [id, value] of Object.entries(values.custom ?? {})) if (value === null) delete custom[id]; else custom[id] = value
  if (!changed.length && !customChanged.length) return { id: person.id, action: null, changed: [] as string[], customFields: [] as string[] }
  const next = { ...current, ...values } as Record<string, any>
  const statements = [stmt(env, `UPDATE beam_members SET employee_id = ?, name = ?, email = ?, mobile = ?, employment = ?, manager_id = ?, hire_date = ?, transfer_date = ?, preferred_name = ?, language = ?, job_role = ?, department = ?, location = ?, time_zone = ?, custom_json = ? WHERE id = ?`,
    next.employeeId, next.name, next.email, next.mobile, next.employment, next.manager, next.hireDate, next.transferDate, next.preferredName, next.language, next.jobRole, next.department, next.location, next.timeZone, JSON.stringify(custom), person.id)]
  // Field names only, plus the employee id, the email and the employment move: never a mobile number or custom value.
  const detail: Row = { employeeId: next.employeeId, fields: changed.map(key => LABELS[key]), customFields: customChanged }
  if (changed.includes('email')) detail.email = { from: person.email, to: next.email }
  if (changed.includes('employment')) detail.employment = { from: person.employment, to: next.employment }
  const rehired = person.employment === 'terminated' && next.employment !== 'terminated'
  const action = rehired ? 'person.rehire' : changed.includes('employment') && next.employment === 'terminated' ? 'person.leave' : 'person.directory'
  const invited = changed.includes('email') && next.email && person.operator_id ? await one<{ status: string }>(env, 'SELECT status FROM oa_operators WHERE id = ?', person.operator_id) : null
  await commit(env, statements, { actor, action, subject: person.id, detail })
  let signIn: string | null = null
  if (invited?.status === 'invited') {
    // The unused invitation goes to the new address; the earlier one no longer reaches this person (the link is by account).
    await operatorAuth(env).invite(request, { email: next.email, displayName: next.name, role: 'member', returnTo: '/app' })
    await commit(env, [stmt(env, 'UPDATE beam_members SET operator_id = (SELECT id FROM oa_operators WHERE lower(email) = ?) WHERE id = ?', next.email, person.id)], { actor, action: 'person.reinvite', subject: person.id, detail: { email: next.email } })
    signIn = 'invitation_resent'
  } else if (invited) signIn = 'sign_in_email_unchanged'
  return { id: person.id, action, changed: detail.fields, customFields: customChanged, ...(signIn ? { signIn } : {}) }
}

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += char
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(cells => cells.some(value => value.trim()))
}

/** Roster columns (header names, any case and spacing); custom fields are columns named by their label. */
export const COLUMNS: Record<string, keyof Values | 'managerEmployeeId' | 'team' | 'username'> = {
  employeeid: 'employeeId', name: 'name', preferredname: 'preferredName', email: 'email', workemail: 'email', mobile: 'mobile', mobilenumber: 'mobile', language: 'language', preferredlanguage: 'language',
  employment: 'employment', employmentstate: 'employment', status: 'employment', manageremployeeid: 'managerEmployeeId', role: 'jobRole', jobrole: 'jobRole', department: 'department', location: 'location', hiredate: 'hireDate', transferdate: 'transferDate', timezone: 'timeZone', team: 'team', username: 'username', login: 'username',
}
export const key = (header: string) => header.toLowerCase().replace(/[^a-z]/g, '')

/** People › Import a roster: a CSV with an employee id on every row. Rows are matched by employee id; a new id with no
 * email or an unused email adds a person (a learner, no invitation sent); a known id updates that person (a leaver
 * whose row is active again is rehired); a blank cell leaves the stored value as it is. A row whose employee id and
 * email belong to two different people, or whose email belongs to someone with another employee id, changes nothing
 * and waits as a conflict for resolution. */
export async function importRoster(env: Bindings, request: Request, actor: Actor, input: Input) {
  insist(!actor.agent && !actor.viewAs && (actor.owner || actor.adminUnits.length > 0), 'owner_required', 403)
  const file = await input.file('file', { optional: true, maxBytes: 2_000_000 })
  const text = file ? new TextDecoder().decode(file.bytes) : input.text('csv', { max: 2_000_000 })
  const [header, ...lines] = parseCsv(text.replace(/^﻿/, ''))
  insist(header && lines.length > 0 && lines.length <= 5000, 'roster_empty')
  for (const cells of lines) await refuseErasedIdentity(env, cells)
  const fields = await directoryFields(env)
  const columns = header.map(name => COLUMNS[key(name)] ?? fields.find(field => key(field.label) === key(name))?.id ?? null)
  insist(columns.includes('employeeId') && columns.includes('name'), 'roster_headers', 400, { needs: ['Employee ID', 'Name'] })
  const teams = new Map((await all<{ id: string; name: string; unit_id: string | null }>(env, 'SELECT id, name, unit_id FROM beam_teams')).map(team => [team.name.toLowerCase(), team]))
  const result = { created: [] as string[], updated: [] as string[], rehired: [] as string[], unchanged: 0, conflicts: [] as Row[], errors: [] as Row[] }
  const managers: [string, string][] = []
  for (const [index, cells] of lines.entries()) {
    const line = index + 2
    try {
      const values: Values = {}, custom: Record<string, string | null> = {}
      let managerEmployeeId = '', teamName = ''
      columns.forEach((column, i) => {
        // A blank cell keeps what is stored: a roster adds and changes values, and only an edit clears one.
        const value = (cells[i] ?? '').trim()
        if (!column || !value) return
        if (column === 'managerEmployeeId') managerEmployeeId = value
        else if (column === 'team') teamName = value
        else if (column === 'username') return
        else if (column === 'employment') values.employment = value.toLowerCase() as Employment
        else if (column in LABELS) (values as Record<string, unknown>)[column] = value
        else custom[column] = value
      })
      if (Object.keys(custom).length) values.custom = custom
      insist(values.employeeId, 'missing_employee_id')
      insist(values.name, 'missing_name')
      check(values)
      const team = teamName ? teams.get(teamName.toLowerCase()) : undefined
      insist(!teamName || team, 'team_not_found')
      const holder = await one<Person>(env, 'SELECT * FROM beam_members WHERE employee_id = ?', values.employeeId)
      const byEmail = values.email ? await one<Person>(env, 'SELECT * FROM beam_members WHERE email = ?', values.email) : null
      const other = byEmail && byEmail.id !== holder?.id && (holder || byEmail.employee_id) ? byEmail : null
      if (other) {
        result.conflicts.push(await holdConflict(env, actor, { values: values as Values & { employeeId: string }, managerEmployeeId, team: team?.id ?? null, holder: holder?.id ?? null, other: other.id, line }))
        continue
      }
      const target = holder ?? byEmail
      if (target) {
        await requireEditor(env, actor, target.id)
        const applied = await applyValues(env, request, actor, target, values)
        if (team) await joinTeam(env, actor, target.id, team)
        if (applied.action === 'person.rehire') result.rehired.push(target.id)
        else if (applied.changed.length || applied.customFields?.length) result.updated.push(target.id)
        else result.unchanged++
        if (managerEmployeeId) managers.push([target.id, managerEmployeeId])
        continue
      }
      const id = await addPerson(env, request, actor, values, team)
      result.created.push(id)
      if (managerEmployeeId) managers.push([id, managerEmployeeId])
    } catch (error) {
      if (!(error instanceof BeamError)) throw error
      result.errors.push({ line, error: error.message })
    }
  }
  // Managers last, so a row may name a manager who appears further down the file.
  for (const [memberId, employeeId] of managers) {
    const manager = await one<{ id: string }>(env, 'SELECT id FROM beam_members WHERE employee_id = ?', employeeId)
    if (!manager) { result.errors.push({ employeeId, error: 'manager_not_found' }); continue }
    await applyValues(env, request, actor, (await one<Person>(env, 'SELECT * FROM beam_members WHERE id = ?', memberId))!, { manager: manager.id })
  }
  return result
}

/** Holds a row whose employee id and email belong to two different people (or whose email belongs to someone with
 * another employee id) for the owner or a unit administrator to resolve; nothing is merged. */
export async function holdConflict(env: Bindings, actor: Actor, row: { values: Values & { employeeId: string }; managerEmployeeId: string; team: string | null; holder: string | null; other: string; line: number }) {
  const conflict = { id: newId(), employeeId: row.values.employeeId, holder: row.holder, other: row.other, reason: row.holder ? 'employee_id_and_email_differ' : 'email_has_other_employee_id', line: row.line }
  await commit(env, [stmt(env, 'INSERT INTO beam_directory_conflicts (id, employee_id, holder_id, other_id, row_json, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', conflict.id, row.values.employeeId, row.holder, row.other, JSON.stringify({ values: row.values, managerEmployeeId: row.managerEmployeeId, team: row.team }), conflict.reason, actor.id, now())],
    { actor, action: 'person.conflict', subject: row.holder ?? row.other, detail: { employeeId: row.values.employeeId, reason: conflict.reason, other: row.other } })
  return conflict
}

/** A new person from a roster row: a learner in the row's team, with no invitation sent. A learning administrator adds
 * people only into their units' teams. */
export async function addPerson(env: Bindings, request: Request, actor: Actor, values: Values, team: { id: string; unit_id: string | null } | undefined) {
  insist(actor.owner || (team && actor.adminUnits.includes(team.unit_id ?? '')), 'outside_your_units', 403)
  await refuseErasedIdentity(env, [values.email, values.employeeId])
  const id = newId()
  await env.DB.batch([stmt(env, 'INSERT INTO beam_members (id, email, name, created_at) VALUES (?, ?, ?, ?)', id, values.email ?? null, values.name, now()), stmt(env, "INSERT INTO beam_member_roles (member_id, role) VALUES (?, 'learner')", id),
    ...(team ? [stmt(env, 'INSERT OR IGNORE INTO beam_team_members (team_id, member_id) VALUES (?, ?)', team.id, id)] : [])])
  await commit(env, [], { actor, action: 'person.add', subject: id, detail: { employeeId: values.employeeId, email: values.email ?? null, team: team?.id ?? null, invited: false } })
  await applyValues(env, request, actor, (await one<Person>(env, 'SELECT * FROM beam_members WHERE id = ?', id))!, { ...values, name: undefined, email: undefined })
  return id
}

export async function joinTeam(env: Bindings, actor: Actor, memberId: string, team: { id: string; unit_id: string | null }) {
  insist(actor.owner || actor.adminUnits.includes(team.unit_id ?? ''), 'outside_your_units', 403)
  if (await one(env, 'SELECT 1 FROM beam_team_members WHERE team_id = ? AND member_id = ?', team.id, memberId)) return
  await commit(env, [stmt(env, 'INSERT INTO beam_team_members (team_id, member_id) VALUES (?, ?)', team.id, memberId)], { actor, action: 'team.join', subject: team.id, detail: { member: memberId } })
}

/** Roster conflicts waiting for resolution: all for the owner, those about their units' people for a learning administrator. */
export async function openConflicts(env: Bindings, actor: Actor) {
  if (!actor.owner && !actor.adminUnits.length) return []
  const rows = await all(env, `SELECT c.id, c.employee_id AS employeeId, c.holder_id AS holder, h.name AS holderName, c.other_id AS other, o.name AS otherName, o.employee_id AS otherEmployeeId, c.reason, c.row_json, c.created_at AS createdAt
    FROM beam_directory_conflicts c LEFT JOIN beam_members h ON h.id = c.holder_id JOIN beam_members o ON o.id = c.other_id WHERE c.resolved_at IS NULL ORDER BY c.created_at`)
  const mine = []
  for (const row of rows) if (actor.owner || (await administers(env, actor, row.holder ?? row.other))) {
    const values = JSON.parse(row.row_json).values as Values
    mine.push({ id: row.id, employeeId: row.employeeId, holder: row.holder, holderName: row.holderName, other: row.other, otherName: row.otherName, otherEmployeeId: row.otherEmployeeId, reason: row.reason, name: values.name, email: values.email ?? null, createdAt: row.createdAt })
  }
  return mine
}

/** Resolves a held roster row: `apply` writes it to the employee id's holder, or adds the row as a new person when no one
 * holds its employee id, in both cases without the work email (it stays with the other person, so two employees are
 * never merged); `dismiss` drops it. */
export async function resolveConflict(env: Bindings, request: Request, actor: Actor, input: Input) {
  const id = input.text('conflict', { max: 64 }), decision = input.text('decision')
  insist(decision === 'apply' || decision === 'dismiss', 'invalid_decision')
  const conflict = await one<{ holder_id: string | null; other_id: string; row_json: string; resolved_at: number | null; employee_id: string }>(env, 'SELECT holder_id, other_id, row_json, resolved_at, employee_id FROM beam_directory_conflicts WHERE id = ?', id)
  insist(conflict && !conflict.resolved_at, 'conflict_not_open', 404)
  await requireEditor(env, actor, conflict.holder_id ?? conflict.other_id)
  if (decision === 'apply') {
    const row = JSON.parse(conflict.row_json) as { values: Values; managerEmployeeId: string; team: string | null }
    const manager = row.managerEmployeeId ? await one<{ id: string }>(env, 'SELECT id FROM beam_members WHERE employee_id = ?', row.managerEmployeeId) : null
    const values = { ...row.values, email: undefined, ...(manager ? { manager: manager.id } : {}) }
    if (conflict.holder_id) await applyValues(env, request, actor, (await one<Person>(env, 'SELECT * FROM beam_members WHERE id = ?', conflict.holder_id))!, values)
    else {
      insist(!await one(env, 'SELECT 1 FROM beam_members WHERE employee_id = ?', conflict.employee_id), 'employee_id_in_use', 409)
      await addPerson(env, request, actor, values, row.team ? await one<{ id: string; unit_id: string | null }>(env, 'SELECT id, unit_id FROM beam_teams WHERE id = ?', row.team) ?? undefined : undefined)
    }
  }
  const result = await env.DB.batch([
    stmt(env, 'UPDATE beam_directory_conflicts SET resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND resolved_at IS NULL', decision === 'apply' ? 'applied' : 'dismissed', actor.id, now(), id),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', now(), actor.id, 'person.conflict.resolve', conflict.holder_id ?? conflict.other_id, JSON.stringify({ conflict: id, employeeId: conflict.employee_id, decision })),
  ])
  insist(result[0].meta.changes === 1, 'conflict_not_open', 404)
  return { id, decision }
}
