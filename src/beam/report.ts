// Flow 13's progress report: every assignment (and every completion recorded
// without one, such as offline attendance) with its exact revision, lessons,
// quiz attempts, practical decision, completion, certificate and expiry. The
// CSV carries the same rows the page shows.
import type { Bindings } from '../auth.server'
import { requireRole, type Actor } from './actor'
import { all, insist, now, type Row } from './core'
import { DAY } from './time'

export const STATUSES = ['all', 'open', 'overdue', 'completed', 'expiring'] as const
export interface Filters { course: string; team: string; status: string }

/** A record's one status, as the report, Manage and the learner record show it: a completion is completed (expiring
 * within 30 days of `at`), an open assignment past its due instant is overdue. */
export const recordStatus = (row: { completion?: unknown; expiresAt?: number | null; assignmentStatus: string; dueAt?: number | null }, at: number) =>
  row.completion ? (row.expiresAt && row.expiresAt <= at + 30 * DAY ? 'expiring' : 'completed')
    : ['cancelled', 'replaced'].includes(row.assignmentStatus) ? row.assignmentStatus : row.dueAt! < at ? 'overdue' : 'open'

export function reportFilters(url: URL): Filters {
  const status = url.searchParams.get('status') || 'all'
  insist((STATUSES as readonly string[]).includes(status), 'invalid_status')
  return { course: url.searchParams.get('course') ?? '', team: url.searchParams.get('team') ?? '', status }
}

export async function trainingReport(env: Bindings, actor: Actor, filters: Filters) {
  requireRole(actor, 'manager')
  const at = now()
  const rows = await all(env, `SELECT a.id AS assignment, a.learner_id AS learner, m.name AS learnerName, a.course_id AS course, r.title AS courseTitle, r.number AS revisionNumber, a.course_revision_id AS revision,
      a.status AS assignmentStatus, a.due_at AS dueAt, a.timezone, a.reason,
      (SELECT COUNT(*) FROM beam_lesson_progress p WHERE p.assignment_id = a.id) AS lessonsDone,
      (SELECT COUNT(*) FROM beam_lesson_revisions l WHERE l.course_revision_id = a.course_revision_id) AS lessonsTotal,
      (SELECT COUNT(*) FROM beam_attempts t WHERE t.assignment_id = a.id AND t.kind = 'quiz') AS quizAttempts,
      (SELECT MAX(CASE WHEN t.max_score > 0 THEN t.score * 100 / t.max_score END) FROM beam_attempts t WHERE t.assignment_id = a.id AND t.kind = 'quiz') AS bestPercent,
      (SELECT MAX(t.passed) FROM beam_attempts t WHERE t.assignment_id = a.id AND t.kind = 'quiz') AS quizPassed,
      (SELECT t.state || '|' || COALESCE(dm.name, '') FROM beam_attempts t LEFT JOIN beam_review_decisions d ON d.attempt_id = t.id LEFT JOIN beam_members dm ON dm.id = d.assessor_id WHERE t.assignment_id = a.id AND t.kind = 'practical' ORDER BY t.number DESC LIMIT 1) AS practical,
      c.id AS completion, c.method, c.completed_at AS completedAt, c.expires_at AS expiresAt, k.number AS certificate, k.id AS certificateId
    FROM beam_assignments a JOIN beam_members m ON m.id = a.learner_id JOIN beam_course_revisions r ON r.id = a.course_revision_id
    LEFT JOIN beam_completions c ON c.assignment_id = a.id LEFT JOIN beam_certificates k ON k.completion_id = c.id
    WHERE a.status != 'replaced' AND (? = '' OR a.course_id = ?) AND (? = '' OR a.learner_id IN (SELECT member_id FROM beam_team_members WHERE team_id = ?))
  UNION ALL
    SELECT NULL, c.learner_id, m.name, c.course_id, r.title, r.number, c.course_revision_id, 'completed', NULL, NULL, 'offline', 0, 0, 0, NULL, NULL, NULL,
      c.id, c.method, c.completed_at, c.expires_at, k.number, k.id
    FROM beam_completions c JOIN beam_members m ON m.id = c.learner_id JOIN beam_course_revisions r ON r.id = c.course_revision_id LEFT JOIN beam_certificates k ON k.completion_id = c.id
    WHERE c.assignment_id IS NULL AND (? = '' OR c.course_id = ?) AND (? = '' OR c.learner_id IN (SELECT member_id FROM beam_team_members WHERE team_id = ?))
  ORDER BY learnerName, courseTitle, revisionNumber`, filters.course, filters.course, filters.team, filters.team, filters.course, filters.course, filters.team, filters.team)
  const shaped = rows.map(row => {
    const [practicalState, assessor] = row.practical ? String(row.practical).split('|') : [null, null]
    const status = recordStatus(row as any, at)
    return { ...row, practical: practicalState ? { state: practicalState, assessor: assessor || null } : null, status } as Row
  }).filter(row => filters.status === 'all' || row.status === filters.status)
  const count = (status: string) => shaped.filter(row => row.status === status).length
  return { filters, rows: shaped, summary: { rows: shaped.length, overdue: count('overdue'), completed: count('completed'), expiring: count('expiring'), open: count('open') } }
}

const COLUMNS: [string, (row: any) => unknown][] = [
  ['Learner', row => row.learnerName], ['Course', row => row.courseTitle], ['Revision', row => row.revisionNumber], ['Status', row => row.status],
  ['Due (UTC)', row => row.dueAt ? new Date(row.dueAt).toISOString() : ''], ['Due time zone', row => row.timezone ?? ''],
  ['Lessons done', row => row.lessonsDone], ['Lessons total', row => row.lessonsTotal], ['Quiz attempts', row => row.quizAttempts], ['Best quiz %', row => row.bestPercent ?? ''],
  ['Quiz passed', row => row.quizPassed === 1 ? 'yes' : row.quizAttempts ? 'no' : ''], ['Practical', row => row.practical?.state ?? ''], ['Practical assessor', row => row.practical?.assessor ?? ''],
  ['Completion method', row => row.method ?? ''], ['Completed (UTC)', row => row.completedAt ? new Date(row.completedAt).toISOString() : ''], ['Certificate', row => row.certificate ?? ''],
  ['Expires (UTC)', row => row.expiresAt ? new Date(row.expiresAt).toISOString() : ''], ['Assignment id', row => row.assignment ?? ''], ['Revision id', row => row.revision], ['Completion id', row => row.completion ?? ''],
]

// A cell a spreadsheet would read as a formula is prefixed so it stays text.
const cell = (value: unknown) => {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function reportCsv(report: Awaited<ReturnType<typeof trainingReport>>) {
  return [COLUMNS.map(([name]) => name), ...report.rows.map(row => COLUMNS.map(([, value]) => value(row)))].map(line => line.map(cell).join(',')).join('\r\n') + '\r\n'
}
