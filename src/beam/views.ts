// Read models served at GET /api/beam/... and rendered by the pages.
import { listDashboards, readDashboard } from './dashboards'
import type { Bindings } from '../auth.server'
import { requireRole, type Actor } from './actor'
import { acknowledgmentList, acknowledgmentView } from './acknowledgments'
import { listProposals, proposalDetail } from './agent-work'
import { listPaths } from './assignments'
import { courseDetail, listCourses, revisionDetail } from './courses'
import { surveyResults } from './survey'
import { BeamError, all, insist, one } from './core'
import { compareRevisions, compareSourceVersions } from './history'
import { assignmentView, attemptDetail } from './learning'
import { importedHistory } from './movein/talentlms'
import { importJobs, importSettings } from './movein/door'
import { business, people } from './people'
import { directoryFields, openConflicts, personDirectory } from './directory'
import { reminderMessages } from './plans'
import { practiceView } from './practice'
import { questionPlanView } from './questions'
import { learnerRecord, queues, reminders } from './records'
import { reportFilters, trainingReport } from './report'
import { programQuality } from './quality'
import { providerCosts } from './costs'
import { listDiagnoses } from './interventions'
import { outcomeComparison } from './outcomes'
import { skillTaxonomy } from './skills'
import { recommendations } from './recommendations'
import { listSources } from './sources'
import { requireCourseRole, unitsView } from './units'
import { courseUnits } from './scope'
import { rolesView } from './roles'
import { auditorGrants, sharedEvidence } from './auditors'
import { requireOwner } from './actor'
import { auditFilters, auditLog } from './audit'
import { announcements } from './announcements'
import { transcript } from './transcript'
import { notificationRulesView } from './notification-rules'
import { notificationInbox } from './notification-delivery'
import { automationControlView } from './automation-policy'
import { automationView } from './automation'
import { audiencesView } from './audiences'
import { batchesView } from './roster-batch'
import { inactivityView } from './inactivity'
import { catalog, catalogQuery, waitingRequests } from './catalog'
import { sessionsView } from './live'
import { roster } from './attendance'
import { movePreview } from './moves'
import { collaboration } from './collab'
import { contentQueue } from './feedback'
import { instructorGrants } from './instructors'
import { externalView } from './external'
import { certificateRecord, templates } from './certificates'
import { recognitionView } from './recognition'
import { courseDiscussions, discussionNotices } from './discussions'

type View = (env: Bindings, actor: Actor, request: Request, id: string) => Promise<unknown>

export const views: Record<string, View> = {
  notifications: (env, actor) => notificationInbox(env, actor),
  'notification-rules': (env, actor) => notificationRulesView(env, actor),
  'automation-controls': (env, actor) => automationControlView(env, actor),
  me: async (env, actor) => ({ id: actor.id, email: actor.email, name: actor.name, owner: actor.owner, roles: [...actor.roles], adminUnits: actor.adminUnits, permissions: Object.keys(actor.grants), business: await business(env) }),
  units: (env, actor) => unitsView(env, actor),
  roles: (env, actor) => rolesView(env, actor),
  evidence: (env, actor) => sharedEvidence(env, actor),
  auditors: async (env, actor) => { requireOwner(actor); return await auditorGrants(env) },
  people: (env, actor, request) => people(env, request, actor),
  directory: (env, actor, _request, id) => personDirectory(env, actor, id),
  'directory-fields': async (env, actor) => ({ fields: await directoryFields(env), conflicts: await openConflicts(env, actor) }),
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
  survey: async (env, actor, _request, id) => await surveyResults(env, actor, id),
  revision: async (env, actor, _request, id) => { await requireCourseRole(env, actor, (await one<{ course_id: string }>(env, 'SELECT course_id FROM beam_course_revisions WHERE id = ?', id))?.course_id ?? '', 'author', 'reviewer', 'manager'); return await revisionDetail(env, id) },
  paths: async (env, actor) => { requireRole(actor, 'manager'); return await listPaths(env, actor) },
  assignment: (env, actor, _request, id) => assignmentView(env, actor, id),
  attempt: (env, actor, _request, id) => attemptDetail(env, actor, id),
  record: (env, actor, _request, id) => learnerRecord(env, actor, id === 'me' ? actor.id : id),
  queues: (env, actor) => queues(env, actor),
  reminders: (env, actor) => reminders(env, actor),
  certificate: (env, actor, _request, id) => certificateRecord(env, actor, id),
  'certificate-templates': async (env, actor) => { insist(actor.owner || actor.grants.certificates, 'forbidden', 403); return await templates(env) },
  imports: (env, actor) => importJobs(env, actor),
  'import-settings': (env, actor) => importSettings(env, actor),
  history: (env, actor) => importedHistory(env, actor),
  messages: (env, actor) => reminderMessages(env, actor),
  report: (env, actor, request) => trainingReport(env, actor, reportFilters(new URL(request.url))),
  quality: (env, actor, request) => programQuality(env, actor, new URL(request.url)),
  costs: async (env, actor) => providerCosts(env, actor),
  diagnoses: (env, actor) => listDiagnoses(env, actor),
  outcome: (env, actor, request, id) => outcomeComparison(env, actor, id, new URL(request.url)),
  skills: env => skillTaxonomy(env),
  'skill-recommendations': (env, actor, _request, id) => recommendations(env, actor, id === 'me' ? actor.id : id),
  proposals: (env, actor, request) => listProposals(env, actor, new URL(request.url).searchParams.get('state') ?? 'waiting'),
  proposal: (env, actor, _request, id) => proposalDetail(env, actor, id),
  questions: (env, actor, _request, id) => questionPlanView(env, actor, id),
  practice: (env, actor, _request, id) => practiceView(env, actor, id),
  audit: (env, actor, request) => auditLog(env, actor, auditFilters(new URL(request.url))),
  announcements: (env, actor) => announcements(env, actor),
  transcript: (env, actor, _request, id) => transcript(env, actor, id === 'me' ? actor.id : id),
  automation: (env, actor) => automationView(env, actor),
  audiences: (env, actor) => audiencesView(env, actor),
  'roster-batches': (env, actor) => batchesView(env, actor),
  dashboards: (env, actor) => listDashboards(env, actor),
  dashboard: (env, actor, request, id) => readDashboard(env, actor, id, new URL(request.url)),
  inactivity: (env, actor) => inactivityView(env, actor),
  catalog: (env, actor, request) => catalog(env, actor, catalogQuery(new URL(request.url))),
  'catalog-requests': (env, actor) => waitingRequests(env, actor),
  sessions: (env, actor) => sessionsView(env, actor),
  roster: (env, actor, _request, id) => roster(env, actor, id),
  'move-preview': (env, actor, _request, id) => movePreview(env, actor, id),
  collaboration: (env, actor, _request, id) => collaboration(env, actor, id),
  'content-queue': (env, actor) => contentQueue(env, actor),
  instructors: (env, actor) => instructorGrants(env, actor),
  external: (env, actor) => externalView(env, actor),
  recognition: (env, actor) => recognitionView(env, actor),
  discussions: (env, actor, _request, id) => courseDiscussions(env, actor, id),
  'discussion-notices': (env, actor) => discussionNotices(env, actor),
}

const ROUTES: [RegExp, string][] = [
  [/^notifications$/, 'notifications'], [/^notification-rules$/, 'notification-rules'],
  [/^automation-controls$/, 'automation-controls'],
  [/^me$/, 'me'], [/^units$/, 'units'], [/^roles$/, 'roles'], [/^evidence$/, 'evidence'], [/^auditors$/, 'auditors'], [/^people$/, 'people'], [/^directory$/, 'directory-fields'], [/^directory\/([\w-]+)$/, 'directory'], [/^members$/, 'members'], [/^sources$/, 'sources'], [/^acknowledgments$/, 'acknowledgments'], [/^acknowledgments\/([\w-]+)$/, 'acknowledgment'], [/^courses$/, 'courses'], [/^courses\/([\w-]+)$/, 'course'],
  [/^revisions\/([\w-]+)$/, 'revision'], [/^compare$/, 'compare'], [/^source-compare$/, 'source-compare'], [/^paths$/, 'paths'], [/^assignments\/([\w-]+)$/, 'assignment'], [/^attempts\/([\w-]+)$/, 'attempt'],
  [/^records\/([\w-]+)$/, 'record'], [/^queues$/, 'queues'], [/^reminders$/, 'reminders'], [/^certificates\/([\w-]+)$/, 'certificate'], [/^imports$/, 'imports'], [/^import-settings$/, 'import-settings'], [/^history$/, 'history'],
  [/^dashboards$/, 'dashboards'], [/^dashboards\/([\w-]+)$/, 'dashboard'], [/^messages$/, 'messages'], [/^report$/, 'report'], [/^quality$/, 'quality'], [/^costs$/, 'costs'], [/^diagnoses$/, 'diagnoses'], [/^outcomes\/([\w-]+)$/, 'outcome'], [/^skills$/, 'skills'], [/^skills\/([\w-]+)$/, 'skill-recommendations'], [/^proposals$/, 'proposals'], [/^proposals\/([\w-]+)$/, 'proposal'], [/^questions\/([\w-]+)$/, 'questions'], [/^practice\/([\w-]+)$/, 'practice'], [/^audit$/, 'audit'], [/^announcements$/, 'announcements'], [/^transcripts\/([\w-]+)$/, 'transcript'], [/^automation$/, 'automation'], [/^audiences$/, 'audiences'], [/^roster-batches$/, 'roster-batches'], [/^inactivity$/, 'inactivity'], [/^catalog$/, 'catalog'], [/^catalog-requests$/, 'catalog-requests'], [/^sessions$/, 'sessions'], [/^sessions\/([\w-]+)\/roster$/, 'roster'], [/^revisions\/([\w-]+)\/moves$/, 'move-preview'], [/^revisions\/([\w-]+)\/survey$/, 'survey'], [/^courses\/([\w-]+)\/collaboration$/, 'collaboration'], [/^content-queue$/, 'content-queue'], [/^instructors$/, 'instructors'], [/^external$/, 'external'], [/^certificate-templates$/, 'certificate-templates'], [/^recognition$/, 'recognition'], [/^discussions\/([\w-]+)$/, 'discussions'], [/^discussion-notices$/, 'discussion-notices'],
]

export function route(path: string): { view: View; id: string } {
  for (const [pattern, name] of ROUTES) {
    const match = path.match(pattern)
    if (match) return { view: views[name], id: match[1] ?? '' }
  }
  throw new BeamError('not_found', 404)
}
