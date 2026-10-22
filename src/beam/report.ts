// Flow 13's progress report: every assignment (and every completion recorded
// without one, such as offline attendance) with its exact revision, lessons,
// quiz attempts, practical decision, completion, certificate and expiry. The
// CSV carries the same rows the page shows.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, auditVia, insist, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { closeAllExpired } from './learning'
import { LATEST_EXCEPTION } from './exceptions'
import { DAY } from './time'
import { workbook } from './xlsx'
import { IN_SCOPE, learnerScope, requireTeamScope } from './scope'
import { externalReportRows } from './external'

export const STATUSES = ['all', 'open', 'overdue', 'completed', 'expiring', 'deferred', 'exempt', 'missing'] as const
export interface Filters { course: string; team: string; status: string }

/** How many days ahead a current record counts as expiring: 30 until the owner changes it. */
export async function expiringWindow(env: Bindings) {
  const row = await one(env, 'SELECT expiring_days, version FROM beam_report_settings WHERE id = 1')
  return { days: (row?.expiring_days ?? 30) as number, version: (row?.version ?? 0) as number }
}

/** The owner (acting as admin) sets the installation's expiring window, 1-365 days, against the version they read. */
export async function saveExpiringWindow(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  insist(!actor.agent && !actor.viewAs, 'human_session_required', 403)
  const days = input.integer('days', { min: 1, max: 365 })!, expected = input.integer('version', { min: 0, max: 1_000_000 })!
  const result = await env.DB.batch([
    stmt(env, 'INSERT INTO beam_report_settings (id, expiring_days, version, updated_by, updated_at) SELECT 1, ?, 1, ?, ? WHERE ? = 0 OR EXISTS (SELECT 1 FROM beam_report_settings WHERE id = 1 AND version = ?) ON CONFLICT(id) DO UPDATE SET expiring_days = excluded.expiring_days, version = beam_report_settings.version + 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at WHERE beam_report_settings.version = ?',
      days, actor.id, now(), expected, expected, expected),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail, via) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1', now(), actor.id, 'report.window', 'expiring-window', JSON.stringify({ days, version: expected + 1 }), auditVia(actor)),
  ])
  insist(result[0].meta.changes === 1, 'stale_report_window', 409)
  return { days, version: expected + 1 }
}

/** A record's one status, as the report, Manage and the learner record show it: a completion is completed (expiring
 * within the expiring window, 30 days unless the owner changed it, of `at`); an open assignment under an AUTO-006 exception that still holds is deferred or exempt;
 * otherwise an open assignment past its due instant is overdue. */
export const recordStatus = (row: { completion?: unknown; expiresAt?: number | null; assignmentStatus: string; dueAt?: number | null; exception?: { kind: string; endsAt: number } | null }, at: number, windowDays = 30) =>
  row.completion ? (row.expiresAt && row.expiresAt <= at + windowDays * DAY ? 'expiring' : 'completed')
    : ['cancelled', 'replaced'].includes(row.assignmentStatus) ? row.assignmentStatus
    : row.exception && row.exception.endsAt > at ? (row.exception.kind === 'exemption' ? 'exempt' : 'deferred')
    : row.dueAt! < at ? 'overdue' : 'open'

/** The stored JSON of an assignment's latest exception, with whether it still holds. */
export const parseException = (value: unknown, at: number) => {
  if (!value) return null
  const exception = JSON.parse(String(value))
  return { ...exception, active: exception.endsAt > at }
}

export function reportFilters(url: URL): Filters {
  const status = url.searchParams.get('status') || 'all'
  insist((STATUSES as readonly string[]).includes(status), 'invalid_status')
  return { course: url.searchParams.get('course') ?? '', team: url.searchParams.get('team') ?? '', status }
}

export async function trainingReport(env: Bindings, actor: Actor, filters: Filters) {
  // A manager's report holds only their teams' people (ORG-004), an administrator's their units' (ORG-002);
  // another team is refused.
  const scope = learnerScope(actor, 'reports')
  if (filters.team) requireTeamScope(actor, filters.team, 'reports')
  await closeAllExpired(env, actor)
  const at = now(), window = await expiringWindow(env)
  const rows = await all(env, `SELECT a.id AS assignment, a.learner_id AS learner, m.name AS learnerName, a.course_id AS course, r.title AS courseTitle, r.number AS revisionNumber, a.course_revision_id AS revision,
      a.status AS assignmentStatus, a.due_at AS dueAt, a.timezone, a.reason, a.access_opens_at AS accessOpensAt, a.access_closes_at AS accessClosesAt,
      (SELECT json_object('days', SUM(e.days), 'reason', (SELECT x.reason FROM beam_access_extensions x WHERE x.assignment_id = a.id ORDER BY x.extended_at DESC, x.rowid DESC LIMIT 1), 'by', (SELECT xm.name FROM beam_access_extensions x JOIN beam_members xm ON xm.id = x.extended_by WHERE x.assignment_id = a.id ORDER BY x.extended_at DESC, x.rowid DESC LIMIT 1), 'count', COUNT(*))
        FROM beam_access_extensions e WHERE e.assignment_id = a.id HAVING COUNT(*) > 0) AS extension,
      (SELECT COUNT(*) FROM beam_lesson_progress p WHERE p.assignment_id = a.id) AS lessonsDone,
      (SELECT COUNT(*) FROM beam_lesson_revisions l WHERE l.course_revision_id = a.course_revision_id) AS lessonsTotal,
      (SELECT COUNT(*) FROM beam_attempts t WHERE t.assignment_id = a.id AND t.kind = 'quiz' AND t.reset_id IS NULL) AS quizAttempts,
      (SELECT MAX(CASE WHEN t.max_score > 0 THEN t.score * 100 / t.max_score END) FROM beam_attempts t WHERE t.assignment_id = a.id AND t.kind = 'quiz' AND t.reset_id IS NULL) AS bestPercent,
      (SELECT MAX(t.passed) FROM beam_attempts t WHERE t.assignment_id = a.id AND t.kind = 'quiz' AND t.reset_id IS NULL) AS quizPassed,
      (SELECT t.state || '|' || COALESCE(dm.name, '') FROM beam_attempts t LEFT JOIN beam_review_decisions d ON d.attempt_id = t.id LEFT JOIN beam_members dm ON dm.id = d.assessor_id WHERE t.assignment_id = a.id AND t.kind = 'practical' AND t.reset_id IS NULL ORDER BY t.number DESC LIMIT 1) AS practical,
      c.id AS completion, c.method, c.completed_at AS completedAt, c.expires_at AS expiresAt, k.number AS certificate, k.id AS certificateId,
      ${LATEST_EXCEPTION('a.id')} AS exception,
      COALESCE((SELECT d.previous_due_at FROM beam_due_exceptions d WHERE d.assignment_id = a.id ORDER BY d.approved_at, d.rowid LIMIT 1), a.due_at) AS originalDueAt
    FROM beam_assignments a JOIN beam_members m ON m.id = a.learner_id JOIN beam_course_revisions r ON r.id = a.course_revision_id
    LEFT JOIN beam_completions c ON c.assignment_id = a.id LEFT JOIN beam_certificates k ON k.completion_id = c.id
    WHERE a.status != 'replaced' AND (? = '' OR a.course_id = ?) AND (? = '' OR a.learner_id IN (SELECT member_id FROM beam_team_members WHERE team_id = ?)) AND ${IN_SCOPE('a.learner_id')}
  UNION ALL
    SELECT NULL, c.learner_id, m.name, c.course_id, r.title, r.number, c.course_revision_id, 'completed', NULL, NULL, 'offline', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, NULL,
      c.id, c.method, c.completed_at, c.expires_at, k.number, k.id, NULL, NULL
    FROM beam_completions c JOIN beam_members m ON m.id = c.learner_id JOIN beam_course_revisions r ON r.id = c.course_revision_id LEFT JOIN beam_certificates k ON k.completion_id = c.id
    WHERE c.assignment_id IS NULL AND (? = '' OR c.course_id = ?) AND (? = '' OR c.learner_id IN (SELECT member_id FROM beam_team_members WHERE team_id = ?)) AND ${IN_SCOPE('c.learner_id')}
  ORDER BY learnerName, courseTitle, revisionNumber`, filters.course, filters.course, filters.team, filters.team, scope, scope, filters.course, filters.course, filters.team, filters.team, scope, scope)
  const shaped = rows.map(row => {
    const [practicalState, assessor] = row.practical ? String(row.practical).split('|') : [null, null]
    const exception = parseException(row.exception, at)
    const status = recordStatus({ ...row, exception } as any, at, window.days)
    return { ...row, practical: practicalState ? { state: practicalState, assessor: assessor || null } : null, extension: row.extension ? JSON.parse(row.extension) : null, exception, status } as Row
  }).concat(await externalReportRows(env, scope, filters, at, window.days)).filter(row => filters.status === 'all' || row.status === filters.status)
  const count = (status: string) => shaped.filter(row => row.status === status).length
  return { filters, asOf: at, window, rows: shaped, summary: { rows: shaped.length, overdue: count('overdue'), completed: count('completed'), expiring: count('expiring'), open: count('open'), deferred: count('deferred'), exempt: count('exempt'), missing: count('missing') } }
}

export const COLUMNS: [string, (row: any) => unknown][] = [
  ['Learner', row => row.learnerName], ['Course', row => row.courseTitle], ['Revision', row => row.revisionNumber], ['Status', row => row.status],
  ['Due (UTC)', row => row.dueAt ? new Date(row.dueAt).toISOString() : ''], ['Original due (UTC)', row => row.originalDueAt ? new Date(row.originalDueAt).toISOString() : ''], ['Due time zone', row => row.timezone ?? ''],
  ['Exception', row => row.exception ? `${row.exception.kind}${row.exception.active ? '' : ' (ended)'}` : ''], ['Exception through (due time zone)', row => row.exception?.endsOn ?? ''], ['Exception reason', row => row.exception?.reason ?? ''], ['Exception by', row => row.exception?.by ?? ''],
  ['Access opens (UTC)', row => row.accessOpensAt ? new Date(row.accessOpensAt).toISOString() : ''], ['Access closes (UTC)', row => row.accessClosesAt ? new Date(row.accessClosesAt).toISOString() : ''],
  ['Access extended (days)', row => row.extension?.days ?? ''], ['Extension reason', row => row.extension?.reason ?? ''], ['Extended by', row => row.extension?.by ?? ''],
  ['Lessons done', row => row.lessonsDone], ['Lessons total', row => row.lessonsTotal], ['Quiz attempts', row => row.quizAttempts], ['Best quiz %', row => row.bestPercent ?? ''],
  ['Quiz passed', row => row.quizPassed === 1 ? 'yes' : row.quizAttempts ? 'no' : ''], ['Practical', row => row.practical?.state ?? ''], ['Practical assessor', row => row.practical?.assessor ?? ''],
  ['Kind', row => row.external ? 'external certificate' : 'course'], ['Completion method', row => row.method ?? ''], ['Completed (UTC)', row => row.completedAt ? new Date(row.completedAt).toISOString() : ''], ['Certificate', row => row.certificate ?? ''],
  ['Expires (UTC)', row => row.expiresAt ? new Date(row.expiresAt).toISOString() : ''], ['Assignment id', row => row.assignment ?? ''], ['Revision id', row => row.revision], ['Completion id', row => row.completion ?? ''],
]

// A cell a spreadsheet would read as a formula is prefixed so it stays text.
export const cell = (value: unknown) => {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

type Report = Awaited<ReturnType<typeof trainingReport>>
/** REPORT-003: what an export covers, carried by every CSV row and the workbook's Definitions sheet. */
const describeFilters = (report: Report, names: { course?: string; team?: string }) =>
  `course: ${report.filters.course ? names.course ?? report.filters.course : 'all'}; team: ${report.filters.team ? names.team ?? report.filters.team : 'all'}; status: ${report.filters.status}`
const DEFINITION_COLUMNS = ['As of (UTC)', 'Business time zone', 'Filters']

export function reportCsv(report: Report, zone: string, names: { course?: string; team?: string } = {}) {
  const definitions = [new Date(report.asOf).toISOString(), zone, describeFilters(report, names)]
  return [[...COLUMNS.map(([name]) => name), ...DEFINITION_COLUMNS], ...report.rows.map(row => [...COLUMNS.map(([, value]) => value(row)), ...definitions])].map(line => line.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** The same rows as a workbook, with a Definitions sheet; every matching row is included. */
export function reportWorkbook(report: Report, zone: string, names: { course?: string; team?: string } = {}) {
  return workbook([
    { name: 'Report', rows: [COLUMNS.map(([name]) => name), ...report.rows.map(row => COLUMNS.map(([, value]) => value(row)))] },
    { name: 'Definitions', rows: [['Item', 'Value'], ['As of (UTC)', new Date(report.asOf).toISOString()], ['Business time zone', zone], ['Times', 'Columns marked (UTC) are UTC instants; Due time zone is each assignment’s own zone'], ['Filters', describeFilters(report, names)], ['Rows', report.rows.length], ['Truncation', 'none: every matching row is included']] },
  ])
}
