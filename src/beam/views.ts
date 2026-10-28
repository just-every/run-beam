import { cutoverPreview } from './movein/cutover'
import { microsoftAccount } from './microsoft/account'
import { microsoftSourceStatus } from './microsoft/sources'
import { tutorQuestion, tutorPreview, tutorList, tutorCitation } from './tutor'
import { listPortals } from './enterprise-portals'
import { themeSettings } from './portal-theme'
import { rosterFeeds } from './connect/roster-feeds'
import { courseModelPreview } from './model-course'
import { modelAccount } from './model-account'
import { localeModelPreview } from './model-locale'
import { Input } from './input'
import { sourceOcrConfig, sourceOcrPreview } from './source-ocr'
import { erasureSettings } from './erasure-policy'
import { erasureReport } from './erasure'
import { xapiView } from './packages/xapi-catalog'
import { gustoLanguageView } from './connect/gusto-language'
import { localeView } from './course-locales'
import { ltiView } from './lti'
import { languageSettings } from './language'
import { webhookView } from './webhooks'
import { sourceExtraction } from './source-extraction'
import { renewalView } from './renewals'
import { escalationPolicy } from './escalations'
import { errorFeeds } from './error-feeds'
import { compareErrors } from './diagnosis-comparison'
// Read models served at GET /api/beam/... and rendered by the pages.
import { noticeImpact } from './impact'
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
import { coverageFilters, coverageReport } from './coverage'
import { creditsView } from './credits'
import { programQuality } from './quality'
import { providerCosts } from './costs'
import { operations } from './operations'
import { listDiagnoses } from './interventions'
import { outcomeComparison } from './outcomes'
import { evaluation } from './evaluations'
import { listCredentials } from './app-credentials'
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
  operations,
  portals: listPortals,
  theme: themeSettings,
  'roster-feeds': rosterFeeds,
  'course-model-preview': (env, actor, request, id) => courseModelPreview(env, actor, id, Input.of({ inputs: new URL(request.url).searchParams.getAll('inputs') })),
  'tutor-question': (env,actor,_request,id) => tutorQuestion(env,actor,id),
  'tutor-preview': (env,actor,_request,id) => tutorPreview(env,actor,id),
  'tutor-list': (env,actor,request) => tutorList(env,actor,new URL(request.url).searchParams.get('assignment') ?? undefined),
  'tutor-citation': (env,actor,request,id) => tutorCitation(env,actor,id,new URL(request.url).searchParams.get('passage') ?? ''),
  'microsoft': microsoftAccount, 'microsoft-sources': microsoftSourceStatus,
  'model-account': modelAccount,
  'locale-model-preview': (env, actor, request, id) => { const u = new URL(request.url); return localeModelPreview(env, actor, Input.of({ course:id, baseRevision:u.searchParams.get('baseRevision'), locale:u.searchParams.get('locale'), glossary:u.searchParams.get('glossary') })) },
  'source-ocr': sourceOcrConfig, 'source-ocr-preview': (env, actor, _request, id) => sourceOcrPreview(env, actor, id),
  'erasure-settings': erasureSettings, erasure: (env, actor, _request, id) => erasureReport(env, actor, id),
  webhooks: webhookView,
  'gusto-language': gustoLanguageView,
  language: languageSettings,
  lti: ltiView,
  xapi: xapiView,
  'escalation-policy': async (env, actor) => { requireOwner(actor); return await escalationPolicy(env) },
  notifications: (env, actor) => notificationInbox(env, actor),
  'notification-rules': (env, actor) => notificationRulesView(env, actor),
  'renewals': renewalView,
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
  'source-extraction': (env, actor, _request, id) => sourceExtraction(env, actor, id),
  acknowledgments: (env, actor) => acknowledgmentList(env, actor),
  acknowledgment: (env, actor, _request, id) => acknowledgmentView(env, actor, id),
  courses: async (env, actor) => {
    if (actor.owner || ['author', 'reviewer', 'manager', 'assessor'].some(role => actor.roles.has(role as never))) return await listCourses(env)
    insist(courseUnits(actor).length || actor.authorOf.length, 'forbidden', 403)
    return await listCourses(env, { units: courseUnits(actor), courses: actor.authorOf })
  },
  'course-locales': (env, actor, _request, id) => localeView(env, actor, id),
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
  cutover: (env, actor, _request, id) => cutoverPreview(env, actor, id),
  imports: (env, actor) => importJobs(env, actor),
  'import-settings': (env, actor) => importSettings(env, actor),
  history: (env, actor) => importedHistory(env, actor),
  messages: (env, actor) => reminderMessages(env, actor),
  report: (env, actor, request) => trainingReport(env, actor, reportFilters(new URL(request.url))),
  coverage: (env, actor, request) => coverageReport(env, actor, coverageFilters(new URL(request.url))),
  credits: (env, actor) => creditsView(env, actor),
  quality: (env, actor, request) => programQuality(env, actor, new URL(request.url)),
  costs: async (env, actor) => providerCosts(env, actor),
  'diagnosis-comparison': (env, actor, request, id) => compareErrors(env, actor, id, new URL(request.url)),
  'error-feeds': errorFeeds,
  diagnoses: (env, actor) => listDiagnoses(env, actor),
  outcome: (env, actor, request, id) => outcomeComparison(env, actor, id, new URL(request.url)),
  evaluation: (env, actor, _request, id) => evaluation(env, actor, id),
  'app-credentials': (env, actor) => listCredentials(env, actor),
  skills: env => skillTaxonomy(env),
  'skill-recommendations': (env, actor, _request, id) => recommendations(env, actor, id === 'me' ? actor.id : id),
  proposals: (env, actor, request) => listProposals(env, actor, new URL(request.url).searchParams.get('state') ?? 'waiting'),
  proposal: (env, actor, _request, id) => proposalDetail(env, actor, id),
  impact: (env, actor, _request, id) => noticeImpact(env, actor, id),
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
  [/^operations$/, 'operations'],
  [/^portals$/, 'portals'],
  [/^theme$/, 'theme'],
  [/^roster-feeds$/, 'roster-feeds'],
  [/^courses\/([\w-]+)\/model-preview$/, 'course-model-preview'],
  [/^tutor$/, 'tutor-list'], [/^tutor\/([\w-]+)$/, 'tutor-question'], [/^tutor\/([\w-]+)\/preview$/, 'tutor-preview'], [/^tutor\/([\w-]+)\/citation$/, 'tutor-citation'],
  [/^microsoft$/, 'microsoft'], [/^microsoft-sources$/, 'microsoft-sources'],
  [/^model-account$/, 'model-account'], [/^course-locales\/([\w-]+)\/model-preview$/, 'locale-model-preview'],
  [/^source-ocr$/, 'source-ocr'], [/^sources\/([\w-]+)\/ocr-preview$/, 'source-ocr-preview'],
  [/^erasure-settings$/, 'erasure-settings'], [/^erasure\/([\w-]+)$/, 'erasure'],
  [/^webhooks$/, 'webhooks'], [/^language$/, 'language'], [/^lti$/, 'lti'], [/^xapi$/, 'xapi'],
  [/^sources\/([\w-]+)\/extraction$/, 'source-extraction'],
  [/^escalation-policy$/, 'escalation-policy'],
  [/^notifications$/, 'notifications'], [/^notification-rules$/, 'notification-rules'],
  [/^renewals$/, 'renewals'],
  [/^automation-controls$/, 'automation-controls'],
  [/^me$/, 'me'], [/^units$/, 'units'], [/^roles$/, 'roles'], [/^evidence$/, 'evidence'], [/^auditors$/, 'auditors'], [/^people$/, 'people'], [/^directory$/, 'directory-fields'], [/^directory\/([\w-]+)$/, 'directory'], [/^members$/, 'members'], [/^sources$/, 'sources'], [/^acknowledgments$/, 'acknowledgments'], [/^acknowledgments\/([\w-]+)$/, 'acknowledgment'], [/^courses$/, 'courses'], [/^courses\/([\w-]+)$/, 'course'],
  [/^revisions\/([\w-]+)$/, 'revision'], [/^compare$/, 'compare'], [/^source-compare$/, 'source-compare'], [/^paths$/, 'paths'], [/^assignments\/([\w-]+)$/, 'assignment'], [/^attempts\/([\w-]+)$/, 'attempt'],
  [/^gusto-language$/, 'gusto-language'],
  [/^course-locales\/([\w-]+)$/, 'course-locales'],
  [/^records\/([\w-]+)$/, 'record'], [/^queues$/, 'queues'], [/^reminders$/, 'reminders'], [/^certificates\/([\w-]+)$/, 'certificate'], [/^imports$/, 'imports'], [/^cutover\/([\w-]+)$/, 'cutover'], [/^import-settings$/, 'import-settings'], [/^history$/, 'history'],
  [/^dashboards$/, 'dashboards'], [/^dashboards\/([\w-]+)$/, 'dashboard'], [/^messages$/, 'messages'], [/^report$/, 'report'], [/^coverage$/, 'coverage'], [/^credits$/, 'credits'], [/^quality$/, 'quality'], [/^costs$/, 'costs'], [/^error-feeds$/, 'error-feeds'], [/^diagnoses$/, 'diagnoses'], [/^diagnosis-imports\/([\w-]+)$/, 'diagnosis-comparison'], [/^outcomes\/([\w-]+)$/, 'outcome'], [/^evaluations\/([\w-]+)$/, 'evaluation'], [/^app-credentials$/, 'app-credentials'], [/^skills$/, 'skills'], [/^skills\/([\w-]+)$/, 'skill-recommendations'], [/^proposals$/, 'proposals'], [/^proposals\/([\w-]+)$/, 'proposal'], [/^impact\/([\w-]+)$/, 'impact'], [/^questions\/([\w-]+)$/, 'questions'], [/^practice\/([\w-]+)$/, 'practice'], [/^audit$/, 'audit'], [/^announcements$/, 'announcements'], [/^transcripts\/([\w-]+)$/, 'transcript'], [/^automation$/, 'automation'], [/^audiences$/, 'audiences'], [/^roster-batches$/, 'roster-batches'], [/^inactivity$/, 'inactivity'], [/^catalog$/, 'catalog'], [/^catalog-requests$/, 'catalog-requests'], [/^sessions$/, 'sessions'], [/^sessions\/([\w-]+)\/roster$/, 'roster'], [/^revisions\/([\w-]+)\/moves$/, 'move-preview'], [/^revisions\/([\w-]+)\/survey$/, 'survey'], [/^courses\/([\w-]+)\/collaboration$/, 'collaboration'], [/^content-queue$/, 'content-queue'], [/^instructors$/, 'instructors'], [/^external$/, 'external'], [/^certificate-templates$/, 'certificate-templates'], [/^recognition$/, 'recognition'], [/^discussions\/([\w-]+)$/, 'discussions'], [/^discussion-notices$/, 'discussion-notices'],
]

export function route(path: string): { view: View; id: string } {
  for (const [pattern, name] of ROUTES) {
    const match = path.match(pattern)
    if (match) return { view: views[name], id: match[1] ?? '' }
  }
  throw new BeamError('not_found', 404)
}
