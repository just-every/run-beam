// ORG-006 on People: upload a CSV or XLSX roster, see the write-free preview with its column mapping and each row's
// planned action, choose the rows to apply, and continue an apply that stopped partway.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { COLUMNS, directoryFields } from '../directory'
import { CHUNK, batchesView } from '../roster-batch'
import { card, checks, fileField, form, h, hidden, rows, select } from './html'

const ACTION: Record<string, string> = { create: 'add', update: 'update', transfer: 'transfer', deactivate: 'deactivate', deactivate_missing: 'deactivate (missing from the file)', unchanged: 'no change', conflict: 'hold as a conflict', error: 'not applied' }
const OUTCOME: Record<string, string> = { created: 'added', created_invited: 'added and invited', updated: 'updated', transferred: 'transferred', deactivated: 'deactivated', held: 'held as a conflict', invitation_waiting: 'added; invitation waiting for Base’s sending limit', changed_since_preview: 'skipped: changed since the preview', not_selected: 'not selected', unchanged: 'no change', error: 'not applied' }
const ERROR: Record<string, string> = { missing_identity: 'no email and no employee ID', duplicate_email: 'email repeated in the file', duplicate_employee_id: 'employee ID repeated in the file', duplicate_username: 'username repeated in the file', invalid_manager: 'manager employee ID not found', team_not_found: 'team not found', username_in_use: 'username belongs to someone else', invalid_username: 'username needs 3–40 letters, digits, dots, dashes or underscores', outside_your_units: 'outside your units', missing_name: 'no name', not_employed: 'a new person who has left', owner_required: 'only the owner deactivates', email_has_other_employee_id: 'email belongs to someone with another employee ID' }
const TARGETS: Record<string, string> = { employeeId: 'Employee ID', name: 'Name', preferredName: 'Preferred name', email: 'Work email', username: 'Username', mobile: 'Mobile', language: 'Language', employment: 'Employment', managerEmployeeId: 'Manager employee ID', jobRole: 'Role', department: 'Department', location: 'Location', hireDate: 'Hire date', transferDate: 'Transfer date', timeZone: 'Time zone', team: 'Team' }

export async function batchCards(env: Bindings, actor: Actor) {
  const [view, fields] = await Promise.all([batchesView(env, actor), directoryFields(env)])
  const options = [{ value: 'ignore', label: 'Ignore this column' }, ...[...new Set(Object.values(COLUMNS))].map(value => ({ value, label: TARGETS[value] ?? value })), ...fields.map(item => ({ value: item.id, label: item.label }))]
  const upload = card('Import a roster', h`<p class="muted">A CSV or XLSX file with a header row; each row needs a work email or an employee ID. Columns are matched by name (Employee ID, Name, Email, Username or Login, Mobile, Employment, Manager employee ID, Role, Department, Location, Hire date, Transfer date, Team, and your directory fields) and you can change the mapping. The preview changes nothing and sends nothing. People without an email keep their username and mobile number and are never emailed. People missing from the file stay as they are unless you choose otherwise.</p>
${form('people.batch.preview', '/app/people', [fileField('Roster (CSV or XLSX)', 'file', { required: true, accept: '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), checks('Invitations', 'invite', [{ value: 'yes', label: 'Invite new people who have a work email' }]),
    actor.owner ? select('People missing from the file', 'missing', [{ value: 'keep', label: 'Keep them as they are' }, { value: 'deactivate', label: 'Deactivate them (people with an employee ID only)' }], 'keep') : hidden('missing', 'keep')], 'Preview', { multipart: true })}`, { id: 'roster-import' })
  const batchCard = (batch: any) => {
    const counts = Object.entries(batch.counts).map(([action, n]) => `${n} ${ACTION[action] ?? action}`).join(', ')
    const line = (row: any) => `${row.line ? `Row ${row.line}` : 'Not in the file'}: ${row.name || '(no name)'}`
    const meta = (row: any) => row.outcome ? OUTCOME[row.outcome] ?? row.outcome : `${ACTION[row.action]}${row.errors.length ? ` (${row.errors.map((code: string) => ERROR[code] ?? code).join('; ')})` : ''}${row.changes.length && row.action !== 'create' ? ` · ${row.changes.length} ${row.changes.length === 1 ? 'field' : 'fields'}` : ''}${row.invite ? ' · invitation' : ''}`
    if (batch.state !== 'preview') return card(`Roster ${batch.filename}`, h`<p>${batch.state === 'applied' ? 'Applied.' : `${batch.remaining} rows left to apply.`} ${counts}.${batch.waiting ? ` ${batch.waiting} ${batch.waiting === 1 ? 'invitation waits' : 'invitations wait'}: Base sends at most 30 invitations from one address in 15 minutes, so continue applying later.` : ''}</p>
${batch.state === 'applying' ? form('people.batch.apply', '/app/people', [hidden('batch', batch.id)], `Continue applying (next ${Math.min(CHUNK, batch.remaining)})`) : ''}
<details><summary>Rows</summary>${rows(batch.rows.map((row: any) => ({ title: line(row), meta: meta(row) })))}</details>`, { id: `batch-${batch.id}` })
    const applicable = batch.rows.filter((row: any) => !['unchanged', 'error'].includes(row.action))
    return card(`Preview of ${batch.filename}`, h`<p>${counts}. Nothing has changed yet.${batch.invite ? ' New people with a work email will be invited.' : ''}${batch.missing === 'deactivate' ? ' People missing from the file will be deactivated.' : ''}</p>
<details><summary>Column mapping</summary>${form('people.batch.preview', '/app/people', [hidden('batch', batch.id), hidden('missing', batch.missing), batch.invite ? hidden('invite', 'yes') : '', ...batch.headers.map((header: string, index: number) => select(header, `map_${index}`, options, batch.mapping[index] ?? 'ignore'))], 'Preview again', { secondary: true })}</details>
${batch.rows.filter((row: any) => ['unchanged', 'error'].includes(row.action)).length ? h`<details><summary>Rows that will not change</summary>${rows(batch.rows.filter((row: any) => ['unchanged', 'error'].includes(row.action)).map((row: any) => ({ title: line(row), meta: meta(row) })))}</details>` : ''}
${applicable.length ? form('people.batch.apply', '/app/people', [hidden('batch', batch.id), checks('Rows to apply', 'rows', applicable.map((row: any) => ({ value: String(row.seq), label: `${line(row)} — ${meta(row)}` })), applicable.map((row: any) => String(row.seq)), { scroll: true })], `Apply the selected rows`) : h`<p class="muted">Nothing to apply.</p>`}`, { id: `batch-${batch.id}` })
  }
  return h`${upload}${view.batches.map(batchCard)}`
}
