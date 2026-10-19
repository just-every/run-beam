// The manager's compliance view (/app/manage): the training report's records counted by status, one status's queue
// with what each record is waiting on, coverage per course, and the agent work that touches them. Every figure is
// counted from the same report rows, so the cards, the queue and the coverage always agree.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { listProposals } from './agent-work'
import { all, insist, now } from './core'
import { queues } from './records'
import { trainingReport } from './report'
import { calendarDays } from './time'
import { permits, teamScope } from './scope'

export const QUEUES = ['overdue', 'expiring', 'open', 'completed'] as const
export type Queue = typeof QUEUES[number]
export interface ComplianceFilters { team: string; course: string; status: Queue; q: string; select: string }

export function complianceFilters(url: URL): ComplianceFilters {
  const status = url.searchParams.get('status') as Queue
  return { team: url.searchParams.get('team') ?? '', course: url.searchParams.get('course') ?? '', status: QUEUES.includes(status) ? status : 'overdue', q: (url.searchParams.get('q') ?? '').trim().slice(0, 80), select: url.searchParams.get('select') ?? '' }
}

/** What a record is waiting on, in the queue's status column: `tone` is done, waiting or late. */
export interface Standing { label: string; tone: 'done' | 'waiting' | 'late' }

export async function complianceView(env: Bindings, actor: Actor, filters: ComplianceFilters) {
  insist(permits(actor, 'reports'), 'forbidden', 403)
  // Agent work belongs to authors, reviewers and managers; a custom role's reports show none of it.
  const preparer = actor.owner || ['author', 'reviewer', 'manager'].some(role => actor.roles.has(role as never))
  const at = now()
  const [report, teams, memberTeams, work, blocked, reminded, proposals, approved, declined] = await Promise.all([
    trainingReport(env, actor, { course: filters.course, team: filters.team, status: 'all' }),
    all<{ id: string; name: string; people: number }>(env, 'SELECT t.id, t.name, COUNT(tm.member_id) AS people FROM beam_teams t LEFT JOIN beam_team_members tm ON tm.team_id = t.id WHERE (? IS NULL OR t.id IN (SELECT value FROM json_each(?))) GROUP BY t.id ORDER BY people DESC, t.name', teamScope(actor, 'reports'), teamScope(actor, 'reports')),
    all<{ member: string; name: string }>(env, 'SELECT tm.member_id AS member, t.name FROM beam_team_members tm JOIN beam_teams t ON t.id = tm.team_id ORDER BY t.name'),
    queues(env, actor),
    all<{ id: string }>(env, `SELECT a.id FROM beam_assignments a WHERE a.status = 'open' AND a.prerequisite_course_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM beam_completions c WHERE c.learner_id = a.learner_id AND c.course_id = a.prerequisite_course_id AND (c.expires_at IS NULL OR c.expires_at > ?))`, at),
    all<{ assignment: string; at: number }>(env, 'SELECT assignment_id AS assignment, MAX(created_at) AS at FROM beam_reminder_messages GROUP BY assignment_id'),
    ...['waiting', 'approved', 'declined'].map(state => preparer ? listProposals(env, actor, state) : Promise.resolve([] as Awaited<ReturnType<typeof listProposals>>)),
  ])
  const waiting = proposals.filter(proposal => proposal.canDecide)
  const rows = report.rows.filter(row => row.status !== 'cancelled')
  const count = (status: Queue) => rows.filter(row => row.status === status).length
  const counts = Object.fromEntries(QUEUES.map(status => [status, count(status)])) as Record<Queue, number>
  const teamOf = new Map<string, string>()
  for (const row of memberTeams) if (!teamOf.has(row.member)) teamOf.set(row.member, row.name)
  const exhausted = new Set(work.attemptsExhausted.map(row => row.id)), prerequisite = new Set(blocked.map(row => row.id))
  const remindedAt = new Map(reminded.map(row => [row.assignment, row.at]))
  // A waiting plan touches a record when it reminds that assignment or assigns that person that course.
  const planFor = (row: any) => waiting.find(proposal => proposal.kind === 'reminders' ? proposal.payload.items.some((item: any) => item.assignment === row.assignment)
    : proposal.kind === 'assignment_plan' && proposal.payload.items.some((item: any) => item.learner === row.learner && item.course === row.course))

  function standing(row: any): Standing {
    if (row.status === 'completed') return { label: 'Completed', tone: 'done' }
    if (row.status === 'expiring') return planFor(row) ? { label: 'Renewal plan waiting', tone: 'waiting' } : { label: 'Renewal not assigned', tone: 'late' }
    if (row.practical?.state === 'awaiting_review') return { label: 'Waiting on assessor', tone: 'waiting' }
    if (exhausted.has(row.assignment)) return { label: 'Out of quiz attempts', tone: 'late' }
    if (prerequisite.has(row.assignment)) return { label: 'Prerequisite not done', tone: 'waiting' }
    if (planFor(row)) return { label: 'Reminder drafted', tone: 'waiting' }
    if (remindedAt.has(row.assignment)) return { label: 'Reminder sent', tone: 'waiting' }
    return row.status === 'overdue' ? { label: 'No reminder yet', tone: 'late' } : { label: row.lessonsDone ? 'In progress' : 'Not started', tone: row.lessonsDone ? 'waiting' : 'late' }
  }
  // Whole days between the record's due date and today, on the calendar of the record's own zone.
  const daysFromDue = (row: any) => row.dueAt ? calendarDays(row.dueAt, at, row.timezone) : null
  const shaped: any[] = rows.map((row: any) => ({ ...row, key: row.assignment ?? row.completion ?? `${row.course}:${row.learner}`, team: teamOf.get(row.learner) ?? null, standing: standing(row), days: daysFromDue(row), plan: planFor(row) ?? null }))
  const needle = filters.q.toLowerCase()
  const order: Record<Queue, (a: any, b: any) => number> = {
    overdue: (a, b) => b.days - a.days || a.learnerName.localeCompare(b.learnerName),
    open: (a, b) => a.dueAt - b.dueAt,
    expiring: (a, b) => a.expiresAt - b.expiresAt,
    completed: (a, b) => b.completedAt - a.completedAt,
  }
  const queue = shaped.filter(row => row.status === filters.status && (!needle || `${row.learnerName} ${row.courseTitle} ${row.team ?? ''}`.toLowerCase().includes(needle))).sort(order[filters.status])
  // With nothing chosen, the panel opens on the record that needs a decision first: the first record in this queue that
  // a waiting plan names, in the plan's own order (newest plan first); then the queue's first record.
  const planned = waiting.flatMap(proposal => proposal.payload.items ?? []).map((item: any) => queue.find(row => item.assignment ? row.assignment === item.assignment : row.learner === item.learner && row.course === item.course)).find(Boolean)
  const selected = queue.find(row => row.key === filters.select) ?? planned ?? queue[0] ?? null

  const coverage = [...new Map(rows.map(row => [row.course, row.courseTitle])).entries()].map(([course, title]) => {
    const mine = rows.filter(row => row.course === course), of = (status: Queue) => mine.filter(row => row.status === status).length
    return { course, title, total: mine.length, completed: of('completed'), expiring: of('expiring'), overdue: of('overdue'), open: of('open') }
  }).sort((a, b) => b.total - a.total || a.title.localeCompare(b.title))

  // The strip's recent activity: each proposal's preparation and decision, newest first.
  const activity = [...proposals, ...approved, ...declined].flatMap(proposal => [
    { at: proposal.createdAt as number, who: proposal.viaAgent || proposal.agent ? `${proposal.preparedByName}'s agent` : proposal.preparedByName as string, verb: 'prepared', title: proposal.title as string },
    ...(proposal.decidedAt ? [{ at: proposal.decidedAt as number, who: proposal.decidedByName as string, verb: proposal.state === 'approved' ? 'approved' : 'declined', title: proposal.title as string }] : []),
  ]).sort((a, b) => b.at - a.at).slice(0, 4)

  let detail = null
  if (selected?.assignment) {
    const [assessment] = await all<{ assessor: string | null; assessorName: string | null; maxAttempts: number | null; extra: number; prerequisiteTitle: string | null; email: string }>(env, `SELECT s.assessor_id AS assessor, am.name AS assessorName, s.max_attempts AS maxAttempts, a.extra_attempts AS extra, pc.title AS prerequisiteTitle, m.email
      FROM beam_assignments a JOIN beam_members m ON m.id = a.learner_id LEFT JOIN beam_assessment_revisions s ON s.course_revision_id = a.course_revision_id LEFT JOIN beam_members am ON am.id = s.assessor_id LEFT JOIN beam_courses pc ON pc.id = a.prerequisite_course_id WHERE a.id = ?`, selected.assignment)
    detail = { ...assessment, exhausted: exhausted.has(selected.assignment), blocked: prerequisite.has(selected.assignment), remindedAt: remindedAt.get(selected.assignment) ?? null }
  } else if (selected) {
    const [person] = await all<{ email: string }>(env, 'SELECT email FROM beam_members WHERE id = ?', selected.learner)
    detail = { email: person?.email, assessor: null, assessorName: null, maxAttempts: null, extra: 0, prerequisiteTitle: null, exhausted: false, blocked: false, remindedAt: null }
  }
  // AUTO-006: blockers waiting for a decision and the records a deferral or exemption holds now.
  const excepted = shaped.filter(row => row.status === 'deferred' || row.status === 'exempt')
  return { filters, counts, total: rows.length, teams, queue, selected, detail, coverage, waiting, activity, renewals: work.renewals.length, blockers: work.blockers, excepted, at }
}
export type ComplianceView = Awaited<ReturnType<typeof complianceView>>
