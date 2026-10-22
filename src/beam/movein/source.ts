// TalentLMS originals are carried in one JSON envelope, then decoded by the real
// CSV/XLSX readers. Neither caller-supplied parsed rows nor native effects are accepted.
import type { Bindings } from '../../auth.server'
import { canonicalJson, sha256, type Json, type SourceRecord, type ParsedRecord, type ImportMapping } from '../../modules/import-kit/src/d1/index'
import type { ImportDoorSource } from '../../modules/import-kit/src/door/types'
import { BeamError, all, insist } from '../core'
import { readCsv, readXlsx, type Table } from './tables'

export const mappingVersion = 'talentlms-records-1'
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
function decodeFile(value: any): KitFile {
  insist(value && typeof value.filename === 'string' && value.filename.length > 0 && value.filename.length <= 200, 'invalid_filename')
  insist(typeof value.base64 === 'string' && value.base64.length <= 13_333_336 && /^[A-Za-z0-9+/]*={0,2}$/.test(value.base64), 'invalid_base64')
  const bytes = Uint8Array.from(atob(value.base64), c => c.charCodeAt(0))
  insist(bytes.length > 0 && bytes.length <= 10_000_000, 'file_size')
  return { filename: value.filename, bytes }
}

export async function talentLmsSource(env: Bindings, ownerPrincipalId: string): Promise<ImportDoorSource> {
  const [people, nativeCourses] = await Promise.all([
    all<{id: string; email: string}>(env, 'SELECT id, email FROM beam_members'),
    all<{id: string}>(env, 'SELECT id FROM beam_courses'),
  ])
  const erased = new Set((await all<{digest:string}>(env, 'SELECT digest FROM beam_erasure_tombstones')).map(row => row.digest))
  const portability = await all<{source_identity:string}>(env, 'SELECT source_identity FROM rer_portability_state WHERE id=1')
  const refuse = (value: unknown): void => {
    if (typeof value === 'string') {
      insist(!erased.has(sha256(`${portability[0]?.source_identity}\0identity\0${value.trim().toLowerCase()}`)), 'erased_identity', 409)
    } else if (Array.isArray(value)) value.forEach(refuse)
    else if (value && typeof value === 'object') Object.values(value).forEach(refuse)
  }
  const members = new Map(people.map(member => [member.email, member.id]))
  const beamCourses = new Set(nativeCourses.map(course => course.id))
  let active: ImportMapping | undefined
  return {
    ownerPrincipalId,
    mapping: { version: mappingVersion, map(source) { insist(active, 'source_not_parsed'); return active.map(source) } },
    parse(value: Json): ParsedRecord[] {
      const input = value as any
      insist(input && !Array.isArray(input) && typeof input === 'object', 'invalid_talentlms_bundle')
      const courseList = decodeFile(input.courseList)
      insist(Array.isArray(input.reports) && input.reports.length <= 5, 'invalid_reports')
      const reports = input.reports.map((report: any) => {
        insist(report && typeof report.course === 'string' && report.course.length <= 100, 'invalid_report_course')
        return { course: report.course, file: decodeFile(report.file) }
      }) as {course: string; file: KitFile}[]
      const order = input.dateFormat ?? 'DMY'
      insist(['DMY', 'MDY', 'YMD'].includes(order), 'invalid_date_format')
      const records: ParsedRecord[] = []
      const record = (kind: string, sourceId: string, payload: Json, artifact: string, row: number) => { refuse(payload); records.push({kind, sourceId, payload, pointer: `/${artifact.replaceAll('~', '~0').replaceAll('/', '~1')}/${row}`}) }
      // Course list CSV.
      const list = readCsv(courseList.bytes, courseList.filename)
      insist(list.rows.length >= 1, 'course_list_empty')
      const listColumns = columns(list.rows[0], ['id', 'name', 'code', 'category'])
      if (listColumns.id < 0 || listColumns.name < 0) throw new BeamError('course_list_headers', 400, { found: list.rows[0], needs: ['ID', 'Course'] })
      const courses = new Map<string, { name: string; code: string }>()
      list.rows.slice(1).forEach((cells, index) => {
        const id = cells[listColumns.id]?.trim() ?? '', name = cells[listColumns.name]?.trim() ?? ''
        const payload = { id, name, code: listColumns.code >= 0 ? cells[listColumns.code]?.trim() ?? '' : '', category: listColumns.category >= 0 ? cells[listColumns.category]?.trim() ?? '' : '' }
        if (id) courses.set(id, { name, code: payload.code })
        record('course', `course:${id || `row-${index + 2}`}`, payload, courseList.filename, index + 2)
      })

      // Course reports: users overview plus timeline evidence for earlier completions.
      for (const report of reports) {
        insist(courses.has(report.course), 'report_course_not_in_list', 400, { course: report.course })
        const sheets = readXlsx(report.file.bytes)
        const users = sheets.find(sheet => /user|learner|progress|overview/i.test(sheet.name)) ?? sheets[0]
        const timeline = sheets.find(sheet => /timeline/i.test(sheet.name))
        const usersColumns = readUsers(users)
        users.rows.slice(1).forEach((cells, index) => record('report-user', `${report.course}:users:${index + 2}`, { course: report.course, sheet: users.name, cells: rowObject(users.rows[0], cells), columns: usersColumns }, report.file.filename, index + 2))
        if (timeline) timeline.rows.slice(1).forEach((cells, index) => record('report-timeline', `${report.course}:timeline:${sha256(canonicalJson(cells))}`, { course: report.course, sheet: timeline.name, cells: rowObject(timeline.rows[0], cells) }, report.file.filename, index + 2))
      }


      const mapped = new Map<string, string | null>()
      insist(input.mappings === undefined || (input.mappings && !Array.isArray(input.mappings) && typeof input.mappings === 'object'), 'invalid_course_mapping')
      for (const id of courses.keys()) {
        const target = input.mappings?.[id] || null
        insist(target === null || (typeof target === 'string' && beamCourses.has(target)), 'mapped_course_not_found', 404, { course: id })
        mapped.set(id, target)
      }
      // The source hash includes every bundle option that changes its effects.
      // Catch-up may skip mapping only when that complete interpretation matches.
      for (const record of records) {
        const payload = record.payload as any
        const course = record.kind === 'course' ? payload.id : payload.course
        const cells = payload.cells as Record<string, string> | undefined
        const email = cells ? Object.entries(cells).find(([header]) => HEADERS.email.includes(header.trim().toLowerCase()))?.[1]?.trim().toLowerCase() ?? '' : ''
        payload.interpretation = {dateFormat: order, mappedCourse: mapped.get(course) ?? null,
          courseName: courses.get(course)?.name ?? '', member: members.get(email) ?? null}
      }
      const emitted = new Map<string, string>()
      const completion = (course: string, name: string, email: string, completedOn: string, score: string, origin: string, location: string) => {
        const key = email || name.toLowerCase()
        const target = sha256(`completion:${course}:${key}:${completedOn}`)
        if (emitted.has(target)) return {effects: [], unmapped: [{reason: `duplicate of ${emitted.get(target)}`}]}
        emitted.set(target, location)
        const member = email ? members.get(email) ?? null : null
        const value = { source: 'TalentLMS', sourceCourse: course, sourceCourseName: courses.get(course)!.name, mappedCourse: mapped.get(course) ?? null, name, email, member, completedOn, score, origin, historical: true, accepted: null }
        return { effects: [{ targetKind: 'completion', targetId: target, value: value as Json }], unmapped: member ? [] : [{ reason: `no Beam member with email ${email || '(none)'}; kept unresolved` }] }
      }
      const at = (record: SourceRecord) => record.location.pointer ?? record.location.artifact

      active = {
        version: mappingVersion,
        map(source: SourceRecord) {
          const payload = source.payload as any
          if (source.kind === 'course') {
            if (!payload.id) return {effects: [], rejection: 'course row without an ID'}
            return { effects: [{ targetKind: 'course', targetId: sha256(`course:${payload.id}`), value: { source: 'TalentLMS', sourceId: payload.id, name: payload.name, code: payload.code, category: payload.category, mappedCourse: mapped.get(payload.id) ?? null } }] }
          }
          const cells = payload.cells as Record<string, string>
          const field = (names: string[]) => Object.entries(cells).find(([header]) => names.includes(header.trim().toLowerCase()))?.[1]?.trim() ?? ''
          const name = field(HEADERS.user), email = field(HEADERS.email).toLowerCase()
          if (source.kind === 'report-user') {
            const raw = field(HEADERS.completedOn)
            if (!raw) return { effects: [], unmapped: [{ reason: 'not completed in the report; progress is not imported' }] }
            const completedOn = parseDate(raw, order)
            if (!completedOn) return {effects: [], rejection: `${at(source)}: unreadable completion date "${raw}"`}
            return completion(payload.course, name, email, completedOn, field(HEADERS.score), 'course report: users', at(source))
          }
          const event = field(HEADERS.event)
          if (!/complet/i.test(event) || /not complet|uncomplet|reset/i.test(event)) return { effects: [], unmapped: [{ reason: 'timeline event retained in the original only' }] }
          const completedOn = parseDate(field(HEADERS.date), order)
          if (!completedOn) return {effects: [], rejection: `${at(source)}: unreadable timeline date`}
          return completion(payload.course, name, email, completedOn, '', 'course report: timeline', at(source))
        },
      }
      return records
    },
  }
}

function readUsers(sheet: Table) {
  insist(sheet && sheet.rows.length >= 1, 'report_empty')
  const found = columns(sheet.rows[0], ['user', 'email', 'completedOn'])
  if ((found.user < 0 && found.email < 0) || found.completedOn < 0) throw new BeamError('report_headers', 400, { sheet: sheet.name, found: sheet.rows[0], needs: ['User or Email', 'Completion date'] })
  return found as unknown as Json
}

const rowObject = (header: string[], cells: string[]) => Object.fromEntries(header.map((name, index) => [name || `column ${index + 1}`, cells[index] ?? '']))
