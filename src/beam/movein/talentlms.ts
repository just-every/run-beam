// Move-in kit 1: TalentLMS records first. Reads the course list CSV and per-course
// report workbooks (users overview and timeline), and imports historical
// completions as labelled evidence through Base's import kit: a dry-run preview
// with no writes, apply bound to the reviewed fingerprint, a durable journal,
// retained originals, and undo that preserves later decisions.
// Course content is not reconstructed from progress reports, and imported
// completions never satisfy a current assignment.
import type { Bindings } from '../../auth.server'
import { planD1Import, createD1ImportJob, applyD1ImportBatches, resumeD1Import, undoD1Import, readD1ImportJob, readD1ImportUndoReport, canonicalJson, sha256, type D1ImportContext, type ImportPlan, type SourceBundle, type SourceRecord, type Json } from '../../modules/import-kit/src/d1/index'
import { requireOwner, requireRole, type Actor } from '../actor'
import { BeamError, all, commit, insist, newId, now, one, sha256Hex, stmt } from '../core'
import type { Input } from '../input'
import { readCsv, readXlsx, type Table } from './tables'
import { historyTargets } from './target'

const namespace = 'talentlms', mappingVersion = 'talentlms-records-1'
const MAX_REPORTS = 5, FILE_BYTES = 10_000_000

const HEADERS = {
  id: ['id', 'course id'], name: ['course', 'course name', 'name', 'title'], code: ['code', 'course code'], category: ['category'],
  user: ['user', 'name', 'full name', 'learner'], email: ['email', 'e-mail', 'email address'], status: ['status', 'completion status', 'progress status'],
  progress: ['progress', 'completion %', 'progress %'], completedOn: ['completion date', 'completed on', 'date completed', 'completed'], score: ['score', 'course score'],
  date: ['date', 'timestamp', 'time'], event: ['event', 'action', 'activity', 'description'],
}
type Field = keyof typeof HEADERS

function columns(header: string[], fields: Field[]) {
  const normalised = header.map(cell => cell.trim().toLowerCase())
  return Object.fromEntries(fields.map(field => [field, normalised.findIndex(cell => HEADERS[field].includes(cell))])) as Record<Field, number>
}

export type DateOrder = 'DMY' | 'MDY' | 'YMD'

export function parseDate(value: string, order: DateOrder): string | null {
  const text = value.trim()
  if (!text) return null
  const iso = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month - 1, day))
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null
  }
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text))
    return serial > 60 && serial < 2_958_466 ? new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10) : null
  }
  const ymd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/)
  if (ymd) return iso(+ymd[1], +ymd[2], +ymd[3])
  const parts = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ ,T].*)?$/)
  if (!parts || order === 'YMD') return null
  return order === 'DMY' ? iso(+parts[3], +parts[2], +parts[1]) : iso(+parts[3], +parts[1], +parts[2])
}

interface KitFile { filename: string; bytes: Uint8Array }

/** Files arrive as uploads on the preview form, or as base64 fields carried to the apply form and the JSON API. */
async function kitFile(input: Input, name: string, optional: boolean): Promise<KitFile | null> {
  if (input.has(`${name}_b64`)) return await carried(input, name)
  return await input.file(name, { optional, maxBytes: FILE_BYTES })
}
async function carried(input: Input, name: string): Promise<KitFile> {
  const base64 = input.text(`${name}_b64`, { max: 14_000_000 })
  insist(/^[A-Za-z0-9+/]*={0,2}$/.test(base64), 'invalid_base64')
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
  insist(bytes.length > 0 && bytes.length <= FILE_BYTES, 'file_size')
  return { filename: input.text(`${name}_name`, { max: 200 }), bytes }
}

async function readInputs(input: Input) {
  const courseList = (await kitFile(input, 'courseList', false))!
  const reports: { course: string; file: KitFile }[] = []
  for (let slot = 1; slot <= MAX_REPORTS; slot++) {
    const file = await kitFile(input, `report${slot}`, true)
    if (!file) continue
    reports.push({ course: input.text(`report${slot}Course`, { max: 100 }), file })
  }
  const order = (input.text('dateFormat', { optional: true }) || 'DMY') as DateOrder
  insist(['DMY', 'MDY', 'YMD'].includes(order), 'invalid_date_format')
  return { courseList, reports, order }
}

export interface Preview {
  fingerprint: string
  counts: Json
  courses: { sourceId: string; name: string; code: string; mappedTo: string | null }[]
  identities: { matched: { email: string; member: string }[]; unresolved: { name: string; email: string }[] }
  duplicates: string[]
  attention: { location: string; reason: string }[]
  gaps: string[]
  completions: number
  /** Records an earlier import brought in with different details (for example a person who has since joined). */
  changed: string[]
  carry: Record<string, string>
}

async function build(env: Bindings, actor: Actor, input: Input) {
  const { courseList, reports, order } = await readInputs(input)
  const artifacts: SourceBundle['artifacts'] = [], records: SourceRecord[] = []
  const carry: Record<string, string> = { dateFormat: order }
  const addArtifact = async (file: KitFile, key: string) => {
    const hash = await sha256Hex(file.bytes)
    const base64 = btoa(Array.from(file.bytes, byte => String.fromCharCode(byte)).join(''))
    artifacts.push({ name: file.filename, sha256: hash, size: file.bytes.length, original: { status: 'available', base64 } })
    carry[`${key}_b64`] = base64
    carry[`${key}_name`] = file.filename
    return hash
  }
  const record = (kind: string, sourceId: string, payload: Json, artifactHash: string, artifact: string, row: number) => records.push({ namespace, kind, sourceId, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash, location: { artifact, row } })

  // Course list CSV.
  const listHash = await addArtifact(courseList, 'courseList')
  const list = readCsv(courseList.bytes, courseList.filename)
  insist(list.rows.length >= 1, 'course_list_empty')
  const listColumns = columns(list.rows[0], ['id', 'name', 'code', 'category'])
  if (listColumns.id < 0 || listColumns.name < 0) throw new BeamError('course_list_headers', 400, { found: list.rows[0], needs: ['ID', 'Course'] })
  const courses = new Map<string, { name: string; code: string }>()
  list.rows.slice(1).forEach((cells, index) => {
    const id = cells[listColumns.id]?.trim() ?? '', name = cells[listColumns.name]?.trim() ?? ''
    const payload = { id, name, code: listColumns.code >= 0 ? cells[listColumns.code]?.trim() ?? '' : '', category: listColumns.category >= 0 ? cells[listColumns.category]?.trim() ?? '' : '' }
    if (id) courses.set(id, { name, code: payload.code })
    record('course', `course:${id || `row-${index + 2}`}`, payload, listHash, courseList.filename, index + 2)
  })

  // Course reports: users overview plus timeline evidence for earlier completions.
  for (const [slot, report] of reports.entries()) {
    insist(courses.has(report.course), 'report_course_not_in_list', 400, { course: report.course })
    const hash = await addArtifact(report.file, `report${slot + 1}`)
    carry[`report${slot + 1}Course`] = report.course
    const sheets = await readXlsx(report.file.bytes)
    const users = sheets.find(sheet => /user|learner|progress|overview/i.test(sheet.name)) ?? sheets[0]
    const timeline = sheets.find(sheet => /timeline/i.test(sheet.name))
    const usersColumns = readUsers(users)
    users.rows.slice(1).forEach((cells, index) => record('report-user', `${report.course}:users:${index + 2}:${sha256(canonicalJson(cells))}`, { course: report.course, sheet: users.name, cells: rowObject(users.rows[0], cells), columns: usersColumns }, hash, report.file.filename, index + 2))
    if (timeline) timeline.rows.slice(1).forEach((cells, index) => record('report-timeline', `${report.course}:timeline:${sha256(canonicalJson(cells))}`, { course: report.course, sheet: timeline.name, cells: rowObject(timeline.rows[0], cells) }, hash, report.file.filename, index + 2))
  }

  const members = new Map((await all<{ id: string; email: string }>(env, 'SELECT id, email FROM beam_members')).map(member => [member.email, member.id]))
  const beamCourses = new Set((await all<{ id: string }>(env, 'SELECT id FROM beam_courses')).map(course => course.id))
  const mapped = new Map<string, string | null>()
  for (const id of courses.keys()) {
    const target = input.text(`map_${id}`, { optional: true, max: 100 }) || null
    insist(target === null || beamCourses.has(target), 'mapped_course_not_found', 404, { course: id })
    mapped.set(id, target)
    if (target) carry[`map_${id}`] = target
  }

  const emitted = new Map<string, string>()
  const identities = { matched: new Map<string, string>(), unresolved: new Map<string, string>() }
  const duplicates: string[] = [], attention: { location: string; reason: string }[] = []
  const completion = (course: string, name: string, email: string, completedOn: string, score: string, origin: string, location: string) => {
    const key = email || name.toLowerCase()
    const target = sha256(`completion:${course}:${key}:${completedOn}`)
    if (emitted.has(target)) { duplicates.push(`${location} repeats ${emitted.get(target)}`); return { effects: [], unmapped: [{ reason: `duplicate of ${emitted.get(target)}` }] } }
    emitted.set(target, location)
    const member = email ? members.get(email) ?? null : null
    if (member) identities.matched.set(email, member)
    else identities.unresolved.set(email || name, name)
    const value = { source: 'TalentLMS', sourceCourse: course, sourceCourseName: courses.get(course)!.name, mappedCourse: mapped.get(course) ?? null, name, email, member, completedOn, score, origin, historical: true, accepted: null }
    return { effects: [{ targetKind: 'completion', targetId: target, value: value as Json }], unmapped: member ? [] : [{ reason: `no Beam member with email ${email || '(none)'}; kept unresolved` }] }
  }
  const at = (record: SourceRecord) => { const sheet = (record.payload as any).sheet; return `${record.location.artifact}${sheet ? `, sheet “${sheet}”` : ''} row ${record.location.row}` }

  const context = importContext(env, actor)
  const plan = await planD1Import({ artifacts, records, diagnostics: [] }, {
    version: mappingVersion,
    map(source) {
      const payload = source.payload as any
      if (source.kind === 'course') {
        if (!payload.id) { attention.push({ location: at(source), reason: 'course row without an ID' }); return { effects: [], unmapped: [{ reason: 'course row without an ID' }] } }
        return { effects: [{ targetKind: 'course', targetId: sha256(`course:${payload.id}`), value: { source: 'TalentLMS', sourceId: payload.id, name: payload.name, code: payload.code, category: payload.category, mappedCourse: mapped.get(payload.id) ?? null } }] }
      }
      const cells = payload.cells as Record<string, string>
      const field = (names: string[]) => Object.entries(cells).find(([header]) => names.includes(header.trim().toLowerCase()))?.[1]?.trim() ?? ''
      const name = field(HEADERS.user), email = field(HEADERS.email).toLowerCase()
      if (source.kind === 'report-user') {
        const raw = field(HEADERS.completedOn)
        if (!raw) return { effects: [], unmapped: [{ reason: 'not completed in the report; progress is not imported' }] }
        const completedOn = parseDate(raw, order)
        if (!completedOn) { attention.push({ location: at(source), reason: `unreadable completion date "${raw}"` }); return { effects: [], unmapped: [{ reason: `unreadable completion date "${raw}"` }] } }
        return completion(payload.course, name, email, completedOn, field(HEADERS.score), 'course report: users', at(source))
      }
      const event = field(HEADERS.event)
      if (!/complet/i.test(event) || /not complet|uncomplet|reset/i.test(event)) return { effects: [], unmapped: [{ reason: 'timeline event retained in the original only' }] }
      const completedOn = parseDate(field(HEADERS.date), order)
      if (!completedOn) { attention.push({ location: at(source), reason: `unreadable timeline date "${field(HEADERS.date)}"` }); return { effects: [], unmapped: [{ reason: 'unreadable timeline date' }] } }
      return completion(payload.course, name, email, completedOn, '', 'course report: timeline', at(source))
    },
  }, context)
  const preview: Preview = {
    fingerprint: plan.fingerprint, counts: plan.counts as unknown as Json,
    courses: [...courses].map(([sourceId, course]) => ({ sourceId, name: course.name, code: course.code, mappedTo: mapped.get(sourceId) ?? null })),
    identities: { matched: [...identities.matched].map(([email, member]) => ({ email, member })), unresolved: [...identities.unresolved].map(([email, name]) => ({ name, email: email.includes('@') ? email : '' })) },
    duplicates, attention,
    gaps: [
      'Certificate files are not part of these reports; collect them separately.',
      'Course content is a separate migration; reports carry progress and completion only.',
      ...[...courses.keys()].filter(id => !reports.some(report => report.course === id)).map(id => `No course report supplied for ${courses.get(id)!.name} (${id}).`),
      ...[...mapped].filter(([, target]) => !target).map(([id]) => `${courses.get(id)!.name} (${id}) is not mapped to a Beam course.`),
    ],
    completions: emitted.size, changed: await changedSinceEarlier(env, plan), carry,
  }
  return { plan, preview, context }
}

/** Plan entries whose source an earlier, still-applied import brought in with different content or effects. The kit
 * refuses to apply them (SOURCE_ID_CONTENT_CONFLICT), so the preview names them and apply refuses before any job. */
async function changedSinceEarlier(env: Bindings, plan: ImportPlan) {
  const prior = new Map((await all<{ identity: string; source_hash: string; mapping_version: string; effects_hash: string }>(env, 'SELECT identity, source_hash, mapping_version, effects_hash FROM ik_sources WHERE identity IN (SELECT value FROM json_each(?))', JSON.stringify(plan.entries.map(entry => entry.identity)))).map(row => [row.identity, row]))
  return plan.entries.filter(entry => {
    const row = prior.get(entry.identity)
    return row && (row.source_hash !== entry.source.payloadHash || row.mapping_version !== mappingVersion || row.effects_hash !== sha256(canonicalJson(entry.effects)))
  }).map(entry => { const sheet = (entry.source.payload as any).sheet; return `${entry.source.location.artifact}${sheet ? `, sheet “${sheet}”` : ''} row ${entry.source.location.row}` })
}

function readUsers(sheet: Table) {
  insist(sheet && sheet.rows.length >= 1, 'report_empty')
  const found = columns(sheet.rows[0], ['user', 'email', 'completedOn'])
  if ((found.user < 0 && found.email < 0) || found.completedOn < 0) throw new BeamError('report_headers', 400, { sheet: sheet.name, found: sheet.rows[0], needs: ['User or Email', 'Completion date'] })
  return found as unknown as Json
}

const rowObject = (header: string[], cells: string[]) => Object.fromEntries(header.map((name, index) => [name || `column ${index + 1}`, cells[index] ?? '']))

function ownerAuthority(actor: Actor) {
  return { sql: "EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id = s.operator_id WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > CAST(strftime('%s','now') AS INTEGER) * 1000 AND o.version = s.operator_version AND o.status = 'active' AND o.role = 'owner')", params: [actor.sessionId] }
}

function importContext(env: Bindings, actor: Actor): D1ImportContext {
  return { destination: 'history', namespace, mappingVersion, storage: { database: env.DB as never, targets: historyTargets }, authorization: { principalId: actor.id, predicate: () => ownerAuthority(actor) }, batchSize: 25, reversalPolicy: 'preserve-conflicts' }
}

export async function previewImport(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  return (await build(env, actor, input)).preview
}

export async function applyImport(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const reviewed = input.text('fingerprint', { max: 100 })
  const { plan, preview, context } = await build(env, actor, input)
  insist(plan.fingerprint === reviewed, 'reviewed_fingerprint_changed', 409)
  insist(!preview.changed.length, 'import_changed_since_earlier', 409, { records: preview.changed })
  // Undo releases a job's sources, but the kit replays the job that holds an operation key: a reviewed re-apply of the
  // same files after an undo gets its own key, so it creates a new job.
  const undone = await one<{ count: number }>(env, "SELECT COUNT(*) AS count FROM ik_jobs WHERE destination = 'history' AND fingerprint = ? AND state IN ('undone', 'rolled_back')", reviewed)
  const reviewedContext = { ...context, reviewedFingerprint: reviewed, ...(undone?.count ? { operationKey: `${reviewed}:${undone.count}` } : {}) }
  const job = await createD1ImportJob(plan, reviewedContext)
  const result = await applyD1ImportBatches(job.id, reviewedContext)
  await commit(env, [], { actor: actor.id, action: 'import.apply', subject: job.id, detail: { kit: 'talentlms', fingerprint: reviewed, counts: plan.counts } })
  return { job: job.id, state: result.state }
}

export async function importAction(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const job = input.text('job', { max: 100 }), action = input.text('action')
  const context = importContext(env, actor)
  if (action === 'resume') return await resumeD1Import(job, context)
  if (action === 'undo') {
    const result = await undoD1Import(job, context)
    await commit(env, [], { actor: actor.id, action: 'import.undo', subject: job, detail: { state: result.state } })
    return { job, state: result.state, report: await readD1ImportUndoReport(job, context) }
  }
  throw new BeamError('invalid_action')
}

export async function importJobs(env: Bindings, actor: Actor) {
  requireOwner(actor)
  const context = importContext(env, actor)
  const jobs = await all<{ subject: string; at: number; detail: string }>(env, "SELECT subject, at, detail FROM beam_audit WHERE action = 'import.apply' ORDER BY at DESC")
  const result = []
  for (const row of jobs) {
    const job = await readD1ImportJob(row.subject, context)
    const report = job.state === 'undone' ? await readD1ImportUndoReport(row.subject, context).catch(() => null) : null
    result.push({ id: row.subject, appliedAt: row.at, state: job.state, counts: JSON.parse(row.detail).counts, effects: job.total, retained: report?.dispositions.filter(item => item.disposition === 'retained').map(item => ({ target: item.targetId, reason: item.reason })) ?? [] })
  }
  return result
}

export async function importedHistory(env: Bindings, actor: Actor) {
  requireRole(actor, 'manager')
  return (await all(env, 'SELECT id, kind, payload, revision FROM beam_imported_history ORDER BY kind, id')).map(row => ({ id: row.id, kind: row.kind, revision: row.revision, ...JSON.parse(row.payload) }))
}

/** A later decision on imported evidence: a manager records that it was reviewed. Undo keeps such rows. */
export async function acceptHistory(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'manager')
  const row = await one(env, "SELECT * FROM beam_imported_history WHERE id = ? AND kind = 'completion'", input.text('history', { max: 100 }))
  insist(row, 'history_not_found', 404)
  const payload = JSON.parse(row.payload)
  insist(!payload.accepted, 'history_already_accepted', 409)
  payload.accepted = { by: actor.id, at: now(), note: input.text('note', { max: 1000 }) }
  const revision = newId()
  await commit(env, [stmt(env, 'UPDATE beam_imported_history SET payload = ?, revision = ? WHERE id = ? AND revision = ?', canonicalJson(payload), revision, row.id, row.revision)], { actor: actor.id, action: 'history.accept', subject: row.id, detail: payload.accepted })
  return { id: row.id, revision }
}
