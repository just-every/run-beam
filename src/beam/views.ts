// Read models served at GET /api/beam/... and rendered by the pages.
import type { Bindings } from '../auth.server'
import { requireRole, type Actor } from './actor'
import { acknowledgmentList, acknowledgmentView } from './acknowledgments'
import { listProposals, proposalDetail } from './agent-work'
import { listPaths } from './assignments'
import { courseDetail, listCourses, revisionDetail } from './courses'
import { BeamError, all, insist, one } from './core'
import { compareRevisions, compareSourceVersions } from './history'
import { assignmentView, attemptDetail } from './learning'
import { importJobs, importedHistory } from './movein/talentlms'
import { business, people } from './people'
import { reminderMessages } from './plans'
import { practiceView } from './practice'
import { questionPlanView } from './questions'
import { certificate, learnerRecord, queues, reminders } from './records'
import { reportFilters, trainingReport } from './report'
import { listSources } from './sources'
import { requireCourseRole, unitsView } from './units'
import { courseUnits } from './scope'
import { rolesView } from './roles'
import { auditorGrants, sharedEvidence } from './auditors'
import { requireOwner } from './actor'
import { auditFilters, auditLog } from './audit'
import { announcements } from './announcements'
import { transcript } from './transcript'

type View = (env: Bindings, actor: Actor, request: Request, id: string) => Promise<unknown>

export const views: Record<string, View> = {
  me: async (env, actor) => ({ id: actor.id, email: actor.email, name: actor.name, owner: actor.owner, roles: [...actor.roles], adminUnits: actor.adminUnits, permissions: Object.keys(actor.grants), business: await business(env) }),
  units: (env, actor) => unitsView(env, actor),
  roles: (env, actor) => rolesView(env, actor),
  evidence: (env, actor) => sharedEvidence(env, actor),
  auditors: async (env, actor) => { requireOwner(actor); return await auditorGrants(env) },
  people: (env, actor, request) => people(env, request, actor),
  members: async (env) => await all(env, 'SELECT id, name FROM beam_members ORDER BY name'),
  sources: (env, actor) => listSources(env, actor),
  acknowledgments: (env, actor) => acknowledgmentList(env, actor),
  acknowledgment: (env, actor, _request, id) => acknowledgmentView(env, actor, id),
  courses: async (env, actor) => {
    if (actor.owner || ['author', 'reviewer', 'manager', 'assessor'].some(role => actor.roles.has(role as never))) return await listCourses(env)
    insist(courseUnits(actor).length || actor.authorOf.length, 'forbidden', 403)
    return await listCourses(env, { units: courseUnits(actor), courses: actor.authorOf })
  },
  course: (env, actor, _request, id) => courseDetail(env, actor, id),
  compare: (env, actor, request) => { const query = new URL(request.url).searchParams; return compareRevisions(env, actor, query.get('from') ?? '', query.get('to') ?? '') },
  'source-compare': (env, actor, request) => { const query = new URL(request.url).searchParams; return compareSourceVersions(env, actor, query.get('from') ?? '', query.get('to') ?? '') },
  revision: async (env, actor, _request, id) => { await requireCourseRole(env, actor, (await one<{ course_id: string }>(env, 'SELECT course_id FROM beam_course_revisions WHERE id = ?', id))?.course_id ?? '', 'author', 'reviewer', 'manager'); return await revisionDetail(env, id) },
  paths: async (env, actor) => { requireRole(actor, 'manager'); return await listPaths(env, actor) },
  assignment: (env, actor, _request, id) => assignmentView(env, actor, id),
  attempt: (env, actor, _request, id) => attemptDetail(env, actor, id),
  record: (env, actor, _request, id) => learnerRecord(env, actor, id === 'me' ? actor.id : id),
  queues: (env, actor) => queues(env, actor),
  reminders: (env, actor) => reminders(env, actor),
  certificate: (env, actor, _request, id) => certificate(env, actor, id),
  imports: (env, actor) => importJobs(env, actor),
  history: (env, actor) => importedHistory(env, actor),
  messages: (env, actor) => reminderMessages(env, actor),
  report: (env, actor, request) => trainingReport(env, actor, reportFilters(new URL(request.url))),
  proposals: (env, actor, request) => listProposals(env, actor, new URL(request.url).searchParams.get('state') ?? 'waiting'),
  proposal: (env, actor, _request, id) => proposalDetail(env, actor, id),
  questions: (env, actor, _request, id) => questionPlanView(env, actor, id),
  practice: (env, actor, _request, id) => practiceView(env, actor, id),
  audit: (env, actor, request) => auditLog(env, actor, auditFilters(new URL(request.url))),
  announcements: (env, actor) => announcements(env, actor),
  transcript: (env, actor, _request, id) => transcript(env, actor, id === 'me' ? actor.id : id),
}

const ROUTES: [RegExp, string][] = [
  [/^me$/, 'me'], [/^units$/, 'units'], [/^roles$/, 'roles'], [/^evidence$/, 'evidence'], [/^auditors$/, 'auditors'], [/^people$/, 'people'], [/^members$/, 'members'], [/^sources$/, 'sources'], [/^acknowledgments$/, 'acknowledgments'], [/^acknowledgments\/([\w-]+)$/, 'acknowledgment'], [/^courses$/, 'courses'], [/^courses\/([\w-]+)$/, 'course'],
  [/^revisions\/([\w-]+)$/, 'revision'], [/^compare$/, 'compare'], [/^source-compare$/, 'source-compare'], [/^paths$/, 'paths'], [/^assignments\/([\w-]+)$/, 'assignment'], [/^attempts\/([\w-]+)$/, 'attempt'],
  [/^records\/([\w-]+)$/, 'record'], [/^queues$/, 'queues'], [/^reminders$/, 'reminders'], [/^certificates\/([\w-]+)$/, 'certificate'], [/^imports$/, 'imports'], [/^history$/, 'history'],
  [/^messages$/, 'messages'], [/^report$/, 'report'], [/^proposals$/, 'proposals'], [/^proposals\/([\w-]+)$/, 'proposal'], [/^questions\/([\w-]+)$/, 'questions'], [/^practice\/([\w-]+)$/, 'practice'], [/^audit$/, 'audit'], [/^announcements$/, 'announcements'], [/^transcripts\/([\w-]+)$/, 'transcript'],
]

export function route(path: string): { view: View; id: string } {
  for (const [pattern, name] of ROUTES) {
    const match = path.match(pattern)
    if (match) return { view: views[name], id: match[1] ?? '' }
  }
  throw new BeamError('not_found', 404)
}
