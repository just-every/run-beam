// REPORT-004 (BI feed): the training report as a documented, versioned feed for BI tools on a reports.read application
// credential (CONNECT-014), at GET /api/beam/v1/report/feed.json and /api/beam/v1/report/feed.csv with the report's
// course, team and status filters, inside the credential's teams. Each refresh is a whole snapshot, never a page: the
// rows of REPORT-001's report as committed before `watermark` (the instant it was read, UTC), so totals reconcile with
// the report read at the same instant. The schema id names the field list; a field is never renamed or retyped within
// a schema, `deleted` lists any field a later version drops, and `restricted` names what the feed never carries.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { business } from './people'
import { cell, COLUMNS, reportFilters, trainingReport } from './report'

export const FEED_SCHEMA = 'beam.report-feed.v1'
type Type = 'string' | 'integer' | 'datetime'
// Field ids beside the report's columns, in the same order: learner and course ids lead.
const IDS: [string, Type][] = [
  ['learnerName', 'string'], ['courseTitle', 'string'], ['revisionNumber', 'integer'], ['status', 'string'], ['dueAt', 'datetime'], ['originalDueAt', 'datetime'], ['dueTimeZone', 'string'],
  ['exception', 'string'], ['exceptionThrough', 'string'], ['exceptionReason', 'string'], ['exceptionBy', 'string'], ['accessOpensAt', 'datetime'], ['accessClosesAt', 'datetime'],
  ['accessExtendedDays', 'integer'], ['extensionReason', 'string'], ['extendedBy', 'string'], ['lessonsDone', 'integer'], ['lessonsTotal', 'integer'], ['quizAttempts', 'integer'], ['bestQuizPercent', 'integer'],
  ['quizPassed', 'string'], ['practical', 'string'], ['practicalAssessor', 'string'], ['kind', 'string'], ['completionMethod', 'string'], ['completedAt', 'datetime'], ['certificate', 'string'],
  ['expiresAt', 'datetime'], ['assignmentId', 'string'], ['revisionId', 'string'], ['completionId', 'string'],
]
export const FEED_FIELDS = [
  { name: 'learnerId', type: 'string' as Type, label: 'Learner id' }, { name: 'courseId', type: 'string' as Type, label: 'Course id' },
  ...IDS.map(([name, type], index) => ({ name, type, label: COLUMNS[index][0] })),
]
const RESTRICTED = [
  { field: 'evidence', reason: 'Completion evidence files, attestations and practical submissions stay in Beam, on the learner record.' },
  { field: 'answers', reason: 'Quiz and written answers, practice runs and anonymous survey answers are never report data.' },
  { field: 'contact', reason: 'Work email, mobile number and other directory contact details are not report data.' },
]

async function snapshot(env: Bindings, actor: Actor, url: URL) {
  const report = await trainingReport(env, actor, reportFilters(url))
  const rows = report.rows.map(row => {
    const values = [row.learner, row.course, ...COLUMNS.map(([, value]) => value(row))]
    return Object.fromEntries(FEED_FIELDS.map((field, index) => {
      const value = values[index]
      return [field.name, value === '' || value === undefined ? null : field.type === 'integer' ? Number(value) : String(value)]
    }))
  })
  return { report, rows }
}

export async function reportFeed(env: Bindings, actor: Actor, url: URL) {
  const { report, rows } = await snapshot(env, actor, url)
  return {
    schema: FEED_SCHEMA, watermark: new Date(report.asOf).toISOString(), timeZone: (await business(env))!.timezone, filters: report.filters,
    fields: FEED_FIELDS, deleted: [] as string[], restricted: RESTRICTED, summary: report.summary, rows,
  }
}

export async function reportFeedCsv(env: Bindings, actor: Actor, url: URL) {
  const { report, rows } = await snapshot(env, actor, url)
  const body = [FEED_FIELDS.map(field => field.name), ...rows.map(row => FEED_FIELDS.map(field => row[field.name]))].map(line => line.map(cell).join(',')).join('\r\n') + '\r\n'
  return new Response(body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-beam-schema': FEED_SCHEMA, 'x-beam-watermark': new Date(report.asOf).toISOString() } })
}
