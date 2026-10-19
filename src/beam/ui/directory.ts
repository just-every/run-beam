// ORG-001: the directory on People (roster import, custom fields, held conflicts) and on a person's page (their fields
// as the reader may see them, the edit form for the owner or their unit's learning administrator, and the history).
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all } from '../core'
import { EMPLOYMENT, directoryFields, openConflicts, personDirectory } from '../directory'
import { card, checks, field, fileField, form, h, hidden, rows, select, when } from './html'

export const EMPLOYMENT_LABELS: Record<string, string> = { active: 'Active', leave: 'On leave', terminated: 'Left' }
const REASONS: Record<string, string> = { employee_id_and_email_differ: 'its employee id belongs to one person and its email to another', email_has_other_employee_id: 'its email belongs to someone with another employee id' }

export async function directoryCards(env: Bindings, actor: Actor) {
  if (actor.agent || (!actor.owner && !actor.adminUnits.length)) return ''
  const [fields, conflicts] = await Promise.all([directoryFields(env), openConflicts(env, actor)])
  const columns = ['Employee ID', 'Name', 'Preferred name', 'Email', 'Mobile', 'Language', 'Employment', 'Manager employee ID', 'Role', 'Department', 'Location', 'Hire date', 'Team', ...fields.map(field => field.label)]
  return h`${card('Import a roster', h`<p class="muted">A CSV file with a header row. Each row needs an employee ID and a name; rows are matched by employee ID. Columns: ${columns.join(', ')}. Employment is active, leave or terminated; hire dates are YYYY-MM-DD. New people join as learners and are not sent an invitation. A row whose employee ID and email belong to different people changes nothing and waits below.</p>${form('people.import', '/app/people', [fileField('Roster CSV', 'file', { required: true, accept: '.csv,text/csv' })], 'Import roster', { multipart: true })}`)}
${conflicts.length ? card('Roster conflicts', rows(conflicts.map(conflict => ({
    title: `${conflict.name} (employee ID ${conflict.employeeId})`,
    meta: `Held because ${REASONS[conflict.reason]}: ${conflict.holderName ? `${conflict.holderName} holds the ID` : 'nobody holds the ID'}; ${conflict.otherName}${conflict.otherEmployeeId ? ` (employee ID ${conflict.otherEmployeeId})` : ''} has ${conflict.email}.`,
    aside: h`${form('people.conflict', '/app/people', [hidden('conflict', conflict.id), hidden('decision', 'apply')], conflict.holder ? `Update ${conflict.holderName} without the email` : 'Add as a new person without the email', { secondary: true })}${form('people.conflict', '/app/people', [hidden('conflict', conflict.id), hidden('decision', 'dismiss')], 'Dismiss the row', { secondary: true })}`,
  })))) : ''}
${actor.owner ? card('Directory fields', h`${fields.length ? rows(fields.map(item => ({ title: item.label, meta: item.managersRead ? 'Managers may read it' : 'Managers do not see it' }))) : h`<p class="muted">No custom fields yet.</p>`}<details><summary>Add or change a field</summary>${form('person.field', '/app/people', [fields.length ? select('Field', 'field', fields.map(item => ({ value: item.id, label: item.label })), '', { required: false, blank: 'New field' }) : '', field('Label', 'label'), checks('Visibility', 'managersRead', [{ value: 'yes', label: 'Managers may read it for people in their teams' }])], 'Save field')}</details>`) : ''}`
}

const show = (value: unknown) => value === null || value === undefined || value === '' ? '—' : String(value)

/** The directory card on a person's page; empty for readers who see the name only. */
export async function directoryCard(env: Bindings, actor: Actor, memberId: string, zone: string) {
  let view: Awaited<ReturnType<typeof personDirectory>>
  try { view = await personDirectory(env, actor, memberId) } catch { return '' }
  const person = view.person as Record<string, any>
  const items: [string, unknown][] = [['Employee ID', person.employeeId], ['Preferred name', person.preferredName], ['Work email', person.email], ['Mobile', person.mobile], ['Preferred language', person.language], ['Employment', person.employment && EMPLOYMENT_LABELS[person.employment]], ['Manager', person.manager?.name], ['Role', person.jobRole], ['Department', person.department], ['Location', person.location], ['Hire date', person.hireDate],
    ...(person.custom as { label: string; value: string | null }[]).map(item => [item.label, item.value] as [string, unknown])]
  const shown = items.filter(([label]) => label === 'Manager' ? 'manager' in person : label in LABEL_KEYS ? LABEL_KEYS[label] in person : true)
  const signIn = 'signIn' in view && view.signIn && !view.signIn.matches ? h`<p class="muted">Signs in as ${view.signIn.email}. Only they can change their sign-in email, after verifying the new address in their account settings.</p>` : ''
  const editor = view.editable ? await editForm(env, memberId, person) : ''
  const history = 'history' in view && view.history?.length ? h`<details><summary>Directory history</summary>${rows(view.history.map(event => ({ title: describe(event), meta: `${when(event.at, zone)} · ${event.actorName ?? 'Beam'}` })))}</details>` : ''
  return card('Directory', h`<dl class="facts">${shown.map(([label, value]) => h`<dt>${label}</dt><dd>${show(value)}</dd>`)}</dl>${signIn}${editor}${history}`)
}

const LABEL_KEYS: Record<string, string> = { 'Employee ID': 'employeeId', 'Preferred name': 'preferredName', 'Work email': 'email', Mobile: 'mobile', 'Preferred language': 'language', Employment: 'employment', Role: 'jobRole', Department: 'department', Location: 'location', 'Hire date': 'hireDate' }

function describe(event: { action: string; detail: Record<string, any> }) {
  const detail = event.detail
  if (event.action === 'person.rehire') return `Rehired${detail.employeeId ? ` (employee ID ${detail.employeeId})` : ''}`
  if (event.action === 'person.leave') return 'Left the business'
  if (event.action === 'person.add') return `Added from a roster${detail.employeeId ? ` with employee ID ${detail.employeeId}` : ''}`
  if (event.action === 'person.conflict') return `A roster row for employee ID ${detail.employeeId} was held as a conflict`
  if (event.action === 'person.conflict.resolve') return `Roster conflict for employee ID ${detail.employeeId} ${detail.decision === 'apply' ? 'applied' : 'dismissed'}`
  if (event.action === 'person.reinvite') return `Invitation sent to ${detail.email ?? 'the work email'}`
  if (event.action === 'person.directory' && detail.email) return `Work email changed from ${detail.email.from ?? 'none'} to ${detail.email.to ?? 'none'}${detail.fields.length > 1 ? `; also ${detail.fields.filter((name: string) => name !== 'work email').join(', ')}` : ''}`
  if (event.action === 'person.directory') return `Changed ${[...detail.fields, ...(detail.customFields?.length ? ['custom fields'] : [])].join(', ')}`
  return event.action.replace('person.', '').replace(/\./g, ' ')
}

async function editForm(env: Bindings, memberId: string, person: Record<string, any>) {
  const [fields, everyone] = await Promise.all([directoryFields(env), all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_members WHERE id <> ? ORDER BY name', memberId)])
  const text = (label: string, name: string, value: unknown, type = 'text') => h`${hidden(`${name}Sent`, 'yes')}${field(label, name, { value: value ?? '', required: false, type })}`
  return h`<details><summary>Edit directory</summary>${form('person.directory', `/app/records/${memberId}`, [hidden('member', memberId), field('Name', 'name', { value: person.name }), text('Employee ID', 'employeeId', person.employeeId), text('Preferred name', 'preferredName', person.preferredName), text('Work email', 'email', person.email, 'email'), text('Mobile number', 'mobile', person.mobile, 'tel'), text('Preferred language', 'language', person.language),
    select('Employment', 'employment', EMPLOYMENT.map(value => ({ value, label: EMPLOYMENT_LABELS[value] })), person.employment), hidden('managerSent', 'yes'), select('Manager', 'manager', everyone.map(row => ({ value: row.id, label: row.name })), person.manager?.id ?? '', { required: false, blank: 'None' }),
    text('Role', 'jobRole', person.jobRole), text('Department', 'department', person.department), text('Location', 'location', person.location), text('Hire date', 'hireDate', person.hireDate, 'date'),
    ...fields.map(item => text(item.label, `custom_${item.id}`, (person.custom as { id: string; value: string | null }[]).find(entry => entry.id === item.id)?.value))], 'Save directory')}</details>`
}
