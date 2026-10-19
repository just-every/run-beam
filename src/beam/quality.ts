// REPORT-005: course quality and program effort. For each course and each of its published revisions, over the
// assignments of the people this reader's reports cover (optionally one team): enrollment, elapsed time to completion,
// where learners stopped, how each quiz question was answered, retries and learner feedback; per course, review effort
// and content age. Every figure states its denominator and what is
// missing. Nothing is shown per person, and private practice runs (BEAM-20), anonymous question answers (BEAM-19) and
// the nameless survey (LEARN-001, read at its own door) are never read, so no figure can rank or drill into an individual; all of it is learning activity, not work outcomes.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, insist, now, one, type Row } from './core'
import { learnerScope, requireTeamScope } from './scope'
import { DAY } from './time'

export const DEFINITIONS = {
  activity: 'Every figure is learning activity, never a work outcome or a measure of competence.',
  people: 'No figure is shown per person. Private practice runs, anonymous question answers and the nameless survey are never included; survey results stay with the revision, released only from enough answers.',
  enrollment: 'Assignments of the revision for people in this report (and team), excluding assignments moved to another revision.',
  completionDays: 'Median elapsed calendar time, in days, from assignment to completion, over completed assignments (n). Completions recorded without an assignment have no start and are counted as missing.',
  lessons: 'For each lesson, the assignments that completed it. Stopped after: assignments not completed whose furthest completed lesson is this one; not started: those with no lesson completed.',
  questions: 'Responses on quiz attempts that were not reset. Full credit means the response earned its whole weight; ungraded responses are written answers still waiting for the assessor.',
  retries: 'Assignments with at least one quiz attempt; retried means more than one attempt.',
  feedback: 'Learner feedback and broken-content reports sent on the revision.',
  effort: 'Review cycles from revision records: revisions submitted, returned and published, and the median hours from submission to the reviewer’s decision. Beam does not record time spent writing or reviewing.',
  contentAge: 'Days since the current published revision was approved, with the last upkeep decision and next review date (AUTHOR-006).',
}

const median = (values: number[]) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const round = (value: number | null, places = 1) => value === null ? null : Math.round(value * 10 ** places) / 10 ** places

export async function programQuality(env: Bindings, actor: Actor, url: URL) {
  const scope = learnerScope(actor, 'reports')
  insist(!['learner', 'person', 'member', 'respondent'].some(name => url.searchParams.has(name)), 'individual_drilldown_refused')
  const course = url.searchParams.get('course') ?? '', team = url.searchParams.get('team') ?? ''
  if (team) requireTeamScope(actor, team, 'reports')
  const at = now()
  // ?1 team, ?2 the reader's learners (null for everyone), ?3 the revision.
  const cohort = (column: string) => `(?1 = '' OR ${column} IN (SELECT member_id FROM beam_team_members WHERE team_id = ?1)) AND (?2 IS NULL OR ${column} IN (SELECT value FROM json_each(?2)))`
  const assigned = `a.course_revision_id = ?3 AND a.status != 'replaced' AND ${cohort('a.learner_id')}`
  const revisions = await all(env, `SELECT r.id, r.course_id, r.number, r.state, r.reviewed_at, s.questions_json FROM beam_course_revisions r
    LEFT JOIN beam_assessment_revisions s ON s.course_revision_id = r.id WHERE r.state IN ('published', 'superseded') AND (? = '' OR r.course_id = ?) ORDER BY r.course_id, r.number`, course, course)
  const byCourse = new Map<string, Row[]>()
  for (const revision of revisions) {
    const bind = (sql: string) => env.DB.prepare(sql).bind(team, scope, revision.id)
    const count = await bind(`SELECT COUNT(*) AS assigned, COALESCE(SUM(a.status = 'completed'), 0) AS completed, COALESCE(SUM(a.status = 'open'), 0) AS open, COALESCE(SUM(a.status = 'cancelled'), 0) AS cancelled FROM beam_assignments a WHERE ${assigned}`).first<Row>()
    // A reader whose report covers only some people sees only revisions those people were assigned.
    if (scope !== null && !count!.assigned) continue
    const durations = (await bind(`SELECT c.completed_at - a.assigned_at AS elapsed FROM beam_assignments a JOIN beam_completions c ON c.assignment_id = a.id WHERE ${assigned}`).all<Row>()).results.map(row => row.elapsed / DAY)
    const unassigned = await bind(`SELECT COUNT(*) AS n FROM beam_completions c WHERE c.course_revision_id = ?3 AND c.assignment_id IS NULL AND ${cohort('c.learner_id')}`).first<Row>()
    const lessons = (await bind(`SELECT l.id, l.position, l.title, (SELECT COUNT(*) FROM beam_lesson_progress p JOIN beam_assignments a ON a.id = p.assignment_id WHERE p.lesson_revision_id = l.id AND ${assigned}) AS completed
      FROM beam_lesson_revisions l WHERE l.course_revision_id = ?3 ORDER BY l.position`).all<Row>()).results
    const furthest = (await bind(`SELECT (SELECT MAX(l.position) FROM beam_lesson_progress p JOIN beam_lesson_revisions l ON l.id = p.lesson_revision_id WHERE p.assignment_id = a.id) AS position FROM beam_assignments a WHERE ${assigned} AND a.status != 'completed'`).all<Row>()).results
    const responses = (await bind(`SELECT s.question_id AS question, COUNT(*) AS answered, COALESCE(SUM(s.points IS NOT NULL AND s.points >= s.weight), 0) AS fullCredit, COALESCE(SUM(s.points IS NULL), 0) AS ungraded
      FROM beam_responses s JOIN beam_attempts t ON t.id = s.attempt_id JOIN beam_assignments a ON a.id = t.assignment_id WHERE t.kind = 'quiz' AND t.reset_id IS NULL AND ${assigned} GROUP BY s.question_id`).all<Row>()).results
    const attempts = (await bind(`SELECT COUNT(*) AS attempts, MAX(t.passed) AS passed FROM beam_attempts t JOIN beam_assignments a ON a.id = t.assignment_id WHERE t.kind = 'quiz' AND t.reset_id IS NULL AND ${assigned} GROUP BY a.id`).all<Row>()).results
    const feedback = await bind(`SELECT COALESCE(SUM(f.kind = 'feedback'), 0) AS feedback, COALESCE(SUM(f.kind = 'broken'), 0) AS broken FROM beam_content_feedback f WHERE f.course_revision_id = ?3 AND ${cohort('f.learner_id')}`).first<Row>()
    const questions = revision.questions_json ? JSON.parse(revision.questions_json) as { id: string; prompt: string }[] : []
    const figures = {
      id: revision.id, number: revision.number, state: revision.state,
      enrollment: count, completionDays: { median: round(median(durations)), n: durations.length, missing: unassigned!.n },
      lessons: lessons.map(lesson => ({ position: lesson.position, title: lesson.title, completed: lesson.completed, of: count!.assigned, stoppedAfter: furthest.filter(row => row.position === lesson.position).length })),
      notStarted: furthest.filter(row => row.position === null).length,
      questions: questions.map(question => {
        const row = responses.find(item => item.question === question.id)
        return { prompt: question.prompt, answered: row?.answered ?? 0, fullCredit: row?.fullCredit ?? 0, ungraded: row?.ungraded ?? 0 }
      }),
      retries: { attempted: attempts.length, retried: attempts.filter(row => row.attempts > 1).length, passedAfterRetry: attempts.filter(row => row.attempts > 1 && row.passed === 1).length, attempts: attempts.reduce((sum, row) => sum + row.attempts, 0) },
      feedback,
    }
    byCourse.set(revision.course_id, [...(byCourse.get(revision.course_id) ?? []), figures])
  }
  const courses = []
  for (const [id, figures] of byCourse) {
    const info = (await one(env, 'SELECT c.title, c.next_review_on, p.reviewed_at FROM beam_courses c LEFT JOIN beam_course_revisions p ON p.id = c.published_revision_id WHERE c.id = ?', id))!
    const cycles = await all(env, 'SELECT state, submitted_at, reviewed_at FROM beam_course_revisions WHERE course_id = ?', id)
    const decided = await one(env, `SELECT MAX(at) AS at FROM (SELECT decided_at AS at FROM beam_content_reviews WHERE course_id = ?1 UNION ALL SELECT decided_at FROM beam_source_notices WHERE course_id = ?1)`, id)
    const turnaround = cycles.filter(row => row.reviewed_at).map(row => (row.reviewed_at - row.submitted_at) / 3_600_000)
    courses.push({ id, title: info.title, revisions: figures,
      effort: { submitted: cycles.length, returned: cycles.filter(row => row.state === 'returned').length, published: cycles.filter(row => ['published', 'superseded'].includes(row.state)).length, reviewHours: { median: round(median(turnaround)), n: turnaround.length }, timeSpent: null },
      contentAge: { days: info.reviewed_at ? Math.floor((at - info.reviewed_at) / DAY) : null, lastUpkeepDecisionAt: decided?.at ?? null, nextReviewOn: info.next_review_on ?? null } })
  }
  return { asOf: at, filters: { course, team }, definitions: DEFINITIONS, courses: courses.sort((a, b) => a.title.localeCompare(b.title)) }
}
