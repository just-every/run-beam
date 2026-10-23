import { cutoverPage } from './ui/cutover'
import { captionFile } from './caption-file'
import { sourceOcrPage, sourceOcrConsentPage } from './ui/source-ocr'
import { erasurePage } from './ui/erasure'
import { sourcePreparationPage } from './ui/source-preparation'
import { sourceAsset } from './source-extraction'
import { PDF_LIBRARY_PATH, PDF_BOOTSTRAP_PATH, pdfLibraryResponse, pdfViewerBootstrapResponse, pdfViewerResponse } from './pdf-viewer'
import { learningConnectivityResponse } from './ui/learning-connectivity'
import { sequencePage, sequencePreviewPage } from './ui/microlearning'
import { sequenceView, sequencePreview } from './microlearning'
import { cmi5PublicResponse } from './packages/cmi5-ingest'
import { cmi5Evidence } from './packages/cmi5-runtime'
import { xapiPublicResponse, xapiAttachment } from './packages/xapi-ingest'
import { launchXapi, xapiEvidence } from './packages/xapi-launch'
import { integrationsPage, xapiEvidencePage } from './ui/xapi'
import { packageContentResponse } from './packages/content'
import { packagePlayer, packageEvidencePage } from './packages/player'
import { runtimeEvidence } from './packages/runtime'
import { t } from './messages'
import { ltiPublicResponse, authorizeLti, launchLti } from './lti'
import { languagePreference } from './language'
import { dataExport, dataExportFile } from './data-export'
import { diagnosesPage } from './ui/diagnoses'
// Beam's public doors: /app pages, /app/do/ACTION form posts, /api/beam JSON,
// and access-checked file downloads. Every request resolves the signed-in
// member first; private data is never served to a signed-out request.
import { dashboardsPage, dashboardPage, dashboardCsvResponse, dashboardLinkPage, dashboardLinkAndRedirect } from './ui/dashboards'
import { runtimeBindings, type Bindings } from '../auth.server'
import { AuthError, safeReturnTo } from '../modules/operator-auth/index.mjs'
import { acknowledgmentDocument, acknowledgmentEvidence } from './acknowledgments'
import { issueAgentCredential, requireAgentScope } from './agent-credentials'
import { exemptFromOriginCheck, requireAppScope } from './app-credentials'
import { applicationCall } from './app-api'
import { mcpCall } from './mcp'
import { accessPage, issuedPage, issueAndRedirect } from './ui/app-access'
import { actions } from './actions'
import { currentActor, isManager, type Actor } from './actor'
import { BeamError, insist, one } from './core'
import { listProposals } from './agent-work'
import { Input } from './input'
import { attachmentFile } from './learning'
import { business } from './people'
import { sourceFile } from './sources'
import { coursePage, coursesPage, revisionPage, sourcesPage } from './ui/authoring'
import { revisionComparePage, sourceComparePage } from './ui/history'
import { acknowledgmentPage } from './ui/acknowledgments'
import { dashboard, learnOverview, lessonPage, notFound, practicalPage, quizPage, recordPage } from './ui/learner'
import { attemptPage, businessPage, pathsPage, peoplePage } from './ui/managing'
import { managePage } from './ui/compliance'
import { importBrowserResponse } from './movein/browser'
import { importPage, previewPage, importProgressPage } from './ui/movein'
import { bankFileResponse, bankPreviewPage } from './ui/bank'
import { agentPage } from './ui/agent'
import { evidencePage } from './ui/evidence'
import { practicePage, questionsPage } from './ui/practice'
import { reportCsvResponse, reportPage, reportXlsxResponse } from './ui/report'
import { coveragePage } from './ui/coverage'
import { qualityPage } from './ui/quality'
import { personSkillsPage, skillsPage } from './ui/skills'
import { auditCsvResponse, auditPage } from './ui/audit'
import { announcementsPage } from './ui/announcements'
import { notificationsPage } from './ui/notifications'
import { automationPage } from './ui/automation'
import { catalogPage } from './ui/catalog'
import { sessionsPage } from './ui/live'
import { rosterPage } from './ui/attendance'
import { sessionCalendar } from './ics'
import { externalFile } from './external'
import { certificatePdfResponse } from './certificates'
import { certificatePage, templatesPage, verifyPage } from './ui/certificates'
import { externalPage } from './ui/external'
import { recognitionPage } from './ui/recognition'
import { discussionsPage } from './ui/discussions'
import { discussionFile } from './discussions'
import { sessionForCalendar } from './live'
import { transcriptCsvResponse, transcriptPage, transcriptXlsxResponse } from './ui/transcript'
import { describeError, page, h } from './ui/html'
import { route } from './views'
import { VIEW_PAGES, VIEW_READS, exitView, startView, viewCookie, viewing } from './view-as'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })

function failure(error: unknown): { code: string; status: number; detail?: unknown } {
  if (error instanceof BeamError) return { code: error.code, status: error.status, detail: error.detail }
  if (error instanceof AuthError) return { code: error.code, status: error.status }
  const code = error instanceof Error ? error.message : ''
  if (code.includes('source_unavailable')) return { code: 'source_unavailable', status: 409 }
  if (/^(IMPORT_|PROVENANCE_|TARGET_|NATIVE_EDIT_CONFLICT|REVERSAL_)/.test(code)) return { code: code.split(/[:\s]/)[0].toLowerCase(), status: 409 }
  console.error('beam_internal_error', error)
  return { code: 'internal_error', status: 500 }
}

export async function beamResponse(request: Request, original: Bindings): Promise<Response | null> {
  const response = await beamDoorResponse(request, original), url = new URL(request.url)
  const restricted = url.pathname === '/api/beam/dashboard.link' ||
    url.pathname.startsWith('/api/beam/dashboards/') && url.searchParams.has('key') ||
    url.pathname.startsWith('/app/dashboards/') && (url.searchParams.has('key') || url.pathname.endsWith('.csv') || url.pathname === '/app/dashboards/link')
  if (!response || !restricted) return response
  // Guard refusals and sign-in guidance too, including immutable redirects.
  const guarded = new Response(response.body, response)
  guarded.headers.set('referrer-policy', 'no-referrer')
  guarded.headers.set('cache-control', 'no-store')
  return guarded
}

async function beamDoorResponse(request: Request, original: Bindings): Promise<Response | null> {
  const env = runtimeBindings(original)
  const url = new URL(request.url)
  // These fixed modules contain installed application code only. Opaque PDF
  // frames cannot carry a human cookie on their CORS module requests.
  if (url.pathname === PDF_LIBRARY_PATH || url.pathname === PDF_BOOTSTRAP_PATH) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
    const response = url.pathname === PDF_LIBRARY_PATH ? pdfLibraryResponse() : pdfViewerBootstrapResponse()
    return request.method === 'HEAD' ? new Response(null, response) : response
  }
  const cmi5 = await cmi5PublicResponse(env, request)
  if (cmi5) return cmi5
  const content = await packageContentResponse(env, request).catch(error => { const { code, status } = failure(error); return json({ error: code }, status) })
  if (content) return content
  const xapi = await xapiPublicResponse(env, request)
  if (xapi) return xapi
  const api = url.pathname.startsWith('/api/beam/')
  const protocol = await ltiPublicResponse(env, request).catch(error => { const { code, status } = failure(error); return json({ error: code }, status) })
  if (protocol) return protocol
  // LEARN-002: a certificate's verification link is public and shows only what its template approves.
  const verify = url.pathname.match(/^\/verify\/([^/]+)$/)
  if (verify && ['GET', 'HEAD'].includes(request.method)) return await verifyPage(env, verify[1], url).catch(() => new Response('Not found', { status: 404 }))
  if (!api && url.pathname !== '/app' && !url.pathname.startsWith('/app/')) return null
  if (request.method === 'POST' && request.headers.get('origin') !== env.AUTH_ORIGIN && !exemptFromOriginCheck(request)) return api ? json({ error: 'invalid_origin' }, 403) : new Response('Forbidden', { status: 403 })
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD, POST' } })
  let actor: Actor | null = null
  try {
    actor = await currentActor(env, request)
    if (!actor && !api && /^\/app\/dashboards\/[\w-]+(?:\.csv)?$/.test(url.pathname) && url.searchParams.has('key')) return page('Sign in to open dashboard', null, h`<h1>Sign in to open this dashboard</h1><p>Sign in with the named viewer’s work email, then open your original restricted dashboard link again.</p><p><a href="/signin?returnTo=%2Fapp%2Fdashboards">Sign in</a></p>`, { status: 401 })
    if (!actor) return api ? json({ error: 'authentication_required' }, 401) : Response.redirect(`${env.AUTH_ORIGIN}/signin?returnTo=${encodeURIComponent(url.pathname)}`, 303)
    actor = await viewing(env, request, actor) ?? actor
    actor.locale = (await languagePreference(env, actor.id)).language
    const view = await viewDoor(env, actor, request, url, api)
    if (view) return view
    const pdfPreview = url.pathname.match(/^\/app\/files\/source\/([\w-]+)\/pdf-preview$/)
    if (pdfPreview) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
      const response = await pdfViewerResponse(env, actor, pdfPreview[1], env.AUTH_ORIGIN)
      return request.method === 'HEAD' ? new Response(null, response) : response
    }
    if (url.pathname === '/app/xapi/launch' && request.method === 'POST') { const result = await launchXapi(env, actor, await Input.from(request)); return new Response(null, { status: 303, headers: { location: result.href, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } }) }
    if (url.pathname === '/api/beam/lti/authorize') return await authorizeLti(env, actor, request)
    if (url.pathname === '/app/lti/launch' && request.method === 'POST') { const result = await launchLti(env, actor, await Input.from(request)); return Response.redirect(result.loginUrl, 303) }
    const captionMatch = url.pathname.match(/^\/app\/files\/caption\/([^/]+)$/)
    if (captionMatch && request.method === 'GET') return await captionFile(env, actor, captionMatch[1])
    const sourceAssetMatch = url.pathname.match(/^\/(?:api\/beam\/source-assets|app\/files\/source-asset)\/([^/]+)\/([^/]+)$/)
    if (sourceAssetMatch && request.method === 'GET') return await sourceAsset(env, actor, sourceAssetMatch[1], sourceAssetMatch[2])
    if (api) return await apiResponse(env, actor, request, url)
    return await pageResponse(env, actor, request, url)
  } catch (error) {
    const { code, status, detail } = failure(error)
    if (api) return json({ error: code, ...(detail === undefined ? {} : { detail }) }, status)
    if (status === 404) return notFound(actor)
    return page(t(actor, 'Something went wrong'), actor, h`<h1>${t(actor, 'That did not work')}</h1><p>${t(actor, describeError(code)).replace(/^./, letter => letter.toUpperCase())}</p><p><a href="/app/learning">${t(actor, 'Back to My learning')}</a></p>`, { status })
  }
}

// ORG-012: starting and exiting a view set its cookie; while viewing, only the learner's own pages and reads answer and
// every other write, form and download is refused.
async function viewDoor(env: Bindings, actor: Actor, request: Request, url: URL, api: boolean): Promise<Response | null> {
  const path = api ? url.pathname.slice('/api/beam/'.length) : url.pathname
  const post = request.method === 'POST'
  if (post && (path === 'view.start' || path === '/app/view/start')) {
    const input = await Input.from(request)
    if (!api && actor.viewAs) return redirect(env, '/app/learning', 'error', 'view_as_read_only')
    try {
      const started = await startView(env, actor, input)
      const response = api ? json(started) : redirect(env, '/app/learning', 'notice', 'Viewing as this learner, read-only.')
      response.headers.append('set-cookie', viewCookie(env, started.id))
      return response
    } catch (error) {
      const { code, status } = failure(error)
      if (api || status >= 500) throw error
      return redirect(env, safeReturnTo(input.text('returnTo', { optional: true, max: 300 }) || '/app', '/app'), 'error', code)
    }
  }
  if (post && (path === 'view.end' || path === '/app/view/end')) {
    const ended = await exitView(env, request, actor)
    const response = api ? json(ended) : redirect(env, `/app/records/${ended.learner}`, 'notice', 'View ended.')
    response.headers.append('set-cookie', viewCookie(env, null))
    return response
  }
  if (!actor.viewAs) return null
  if (post) throw new BeamError('view_as_read_only', 403)
  if (!(api ? VIEW_READS.test(path) : VIEW_PAGES.test(path))) throw new BeamError('view_as_learner_pages_only', 403)
  return null
}

async function apiResponse(env: Bindings, actor: Actor, request: Request, url: URL) {
  const path = url.pathname.slice('/api/beam/'.length)
  // CONNECT-016: a browser session never rides the MCP door, even alongside a grant.
  if (path === 'mcp') insist(!request.headers.has('cookie'), 'mcp_session_refused', 403)
  if (actor.app) {
    requireAppScope(actor, path, request.method)
    if (path === 'mcp') return await mcpCall(env, actor, actor.app.tools, request)
    const answer = await applicationCall(env, actor, request, url, path)
    return answer instanceof Response ? answer : json(answer)
  }
  insist(!path.startsWith('v1/'), 'application_credential_required', 403)
  requireAgentScope(actor, path, request.method)
  const sequenceMatch = url.pathname.match(/^\/api\/beam\/sequences\/([^/]+)$/)
  if (sequenceMatch && request.method === 'GET') return json(await sequenceView(env, actor, sequenceMatch[1]))
  const sequencePreviewMatch = url.pathname.match(/^\/api\/beam\/sequence-preview\/([^/]+)$/)
  if (sequencePreviewMatch && request.method === 'GET') return json(await sequencePreview(env, actor, sequencePreviewMatch[1], url.searchParams.get('revision') ?? undefined))
  const cmi5EvidenceMatch = url.pathname.match(/^\/api\/beam\/cmi5-evidence\/([^/]+)$/)
  if (cmi5EvidenceMatch && request.method === 'GET') return json(await cmi5Evidence(env, actor, cmi5EvidenceMatch[1]))
  const xapiEvidenceMatch = url.pathname.match(/^\/api\/beam\/xapi-evidence\/([^/]+)$/)
  if (xapiEvidenceMatch && request.method === 'GET') return json(await xapiEvidence(env, actor, xapiEvidenceMatch[1]))
  if (request.method === 'POST') {
    if (path === 'agent.issue') return json(await issueAgentCredential(env, actor, await Input.from(request)))
    const input = await Input.from(request)
    if (path === 'locale.approve' || path === 'revision.decide' && input.text('decision') === 'publish') throw new BeamError('human_publication_form_required', 403)
    const action = actions[path]
    if (!action) throw new BeamError('not_found', 404)
    return json(await action(env, actor, input, request))
  }
  const source = path.match(/^source-files\/([\w-]+)$/)
  if (source) return sourceFile(env, actor, source[1], true)
  const runtime = path.match(/^package-evidence\/([\w-]+)$/)
  if (runtime) return json(await runtimeEvidence(env, actor, runtime[1]))
  const { view, id } = route(path)
  const response = json(await view(env, actor, request, id))
  if (path.startsWith('dashboards')) response.headers.set('referrer-policy', 'no-referrer')
  return response
}

async function pageResponse(env: Bindings, actor: Actor, request: Request, url: URL): Promise<Response> {
  const sequenceMatch = url.pathname.match(/^\/app\/learn\/([^/]+)\/sequence$/)
  if (sequenceMatch && request.method === 'GET') return sequencePage(env, actor, sequenceMatch[1], url)
  const sequencePreviewMatch = url.pathname.match(/^\/app\/courses\/([^/]+)\/sequence$/)
  if (sequencePreviewMatch && request.method === 'GET') return sequencePreviewPage(env, actor, sequencePreviewMatch[1], url)
  if (url.pathname === '/app/integrations' && request.method === 'GET') return integrationsPage(env, actor, url)
  const xapiEvidenceMatch = url.pathname.match(/^\/app\/xapi\/evidence\/([^/]+)$/)
  if (xapiEvidenceMatch && request.method === 'GET') return xapiEvidencePage(env, actor, xapiEvidenceMatch[1], url)
  const xapiAttachmentMatch = url.pathname.match(/^\/app\/xapi\/attachments\/([^/]+)\/([a-f0-9]{64})$/)
  if (xapiAttachmentMatch && request.method === 'GET') return xapiAttachment(env, actor, xapiAttachmentMatch[1], xapiAttachmentMatch[2])
  const path = url.pathname
  if (request.method !== 'POST' && path === '/app/data-export.json') return dataExport(env, actor)
  const exportFile = path.match(/^\/app\/data-export\/files\/([a-f0-9]{64})$/)
  if (request.method !== 'POST' && exportFile) return dataExportFile(env, actor, exportFile[1])
  if (path === '/app/learning-connectivity.js' && request.method === 'GET') return learningConnectivityResponse()
  if (path === '/app/import/client.js' && request.method === 'GET') return importBrowserResponse()
  if (request.method === 'POST') {
    if (path === '/app/dashboards/link') return dashboardLinkAndRedirect(env, actor, await Input.from(request))
    if (path === '/app/access/issue' || path === '/app/access/rotate') return await issueAndRedirect(env, actor, await Input.from(request), path.endsWith('rotate'))
    if (path === '/app/import/preview') return await previewPage(env, actor, await Input.from(request), url, request)
    const importAction = path.match(/^\/app\/import\/(apply|reconcile|undo)$/)?.[1]
    if (importAction) return await importProgressPage(env, actor, await Input.from(request), url, request, importAction)
    const bank = path.match(/^\/app\/courses\/([\w-]+)\/bank\/preview$/)?.[1]
    if (bank) { const input = await Input.from(request); insist(input.text('course') === bank, 'invalid_course'); return await bankPreviewPage(env, actor, bank, input, url) }
    const name = path.match(/^\/app\/do\/([\w.-]+)$/)?.[1]
    const action = name ? actions[name] : undefined
    if (!action) throw new BeamError('not_found', 404)
    const input = await Input.from(request)
    if (name === 'revision.decide' && input.text('decision') === 'publish' && !(request.headers.get('content-type') ?? '').match(/^(multipart\/form-data|application\/x-www-form-urlencoded)(;|$)/i)) throw new BeamError('human_publication_form_required', 403)
    const returnTo = safeReturnTo(input.text('returnTo', { optional: true, max: 300 }) || '/app', '/app')
    try {
      const result = await action(env, actor, input, request) as { id?: string } | null
      const target = returnTo.replace('{id}', encodeURIComponent(result?.id ?? ''))
      // A practice choice shows its feedback on the page it returns to; no flash.
      if (name === 'practice.choose' || name === 'practice.restart') return new Response(null, { status: 303, headers: { location: target, 'cache-control': 'no-store' } })
      return redirect(env, target, 'notice', 'Saved.')
    } catch (error) {
      const { code, status } = failure(error)
      if (status >= 500) throw error
      if (name === 'package.import' && error instanceof BeamError) return page('Package validation', actor, h`<h1>Package could not be imported</h1><p>${describeError(code)}</p><p>${typeof error.detail === 'object' && error.detail && 'feature' in error.detail ? String(error.detail.feature) : ''}</p><p><a href="${returnTo}">Back to course</a></p>`, { status })
      const refusedTo = name === 'package.launch' ? input.has('assignment') ? `/app/learn/${encodeURIComponent(input.text('assignment'))}` : '/app/courses' : returnTo.replace('/{id}', '')
      return redirect(env, refusedTo, 'error', code)
    }
  }
  // The owner names the business and its time zone before anything else.
  if (!await business(env)) {
    if (actor.owner) return path === '/app/business' ? businessPage(env, actor, url) : Response.redirect(`${env.AUTH_ORIGIN}/app/business`, 303)
    return page('Not ready', actor, h`<h1>Beam is not set up yet</h1><p>The owner needs to name the business first.</p>`)
  }
  actor.shell = await shellFacts(env, actor)
  if (path === '/app/access/issued') return issuedPage(env, actor, request, url)
  if (path === '/app/dashboards/link') return dashboardLinkPage(env, actor, request, url)
  let match: RegExpMatchArray | null
  if ((match = path.match(/^\/app\/packages\/play\/([\w-]+)$/))) return packagePlayer(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/packages\/evidence\/([\w-]+)$/))) return packageEvidencePage(env, actor, match[1], url)
  // Sign-in lands on /app: people who manage training open on Manage, everyone else on My learning.
  if (path === '/app') return isManager(actor) ? Response.redirect(`${env.AUTH_ORIGIN}/app/manage${url.search}`, 303) : dashboard(env, actor, url)
  if (path === '/app/dashboards') return dashboardsPage(env, actor, url)
  if ((match = path.match(/^\/app\/dashboards\/([\w-]+)$/))) return dashboardPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/dashboards\/([\w-]+)\.csv$/))) return dashboardCsvResponse(env, actor, match[1], url)
  if (path === '/app/learning') return dashboard(env, actor, url)
  if (path === '/app/business') return businessPage(env, actor, url)
  if (path === '/app/people') return peoplePage(env, actor, request, url)
  if (path === '/app/erasure') return erasurePage(env, actor, url)
  if (path === '/app/sources/ocr') return sourceOcrPage(env, actor, url)
  const ocrSource = path.match(/^\/app\/sources\/([^/]+)\/ocr$/)
  if (ocrSource) return sourceOcrConsentPage(env, actor, ocrSource[1], url)
  const prepareSource = path.match(/^\/app\/sources\/([^/]+)\/prepare$/)
  if (prepareSource) return sourcePreparationPage(env, actor, prepareSource[1], url)
  if (path === '/app/sources') return sourcesPage(env, actor, url)
  if (path === '/app/courses') return coursesPage(env, actor, url)
  if ((match = path.match(/^\/app\/acknowledgments\/([\w-]+)$/))) return acknowledgmentPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/acknowledgments\/([\w-]+)\/document$/))) return acknowledgmentDocument(env, actor, match[1], url.searchParams.has('download'))
  if ((match = path.match(/^\/app\/acknowledgments\/([\w-]+)\/evidence$/))) return acknowledgmentEvidence(env, actor, match[1])
  if ((match = path.match(/^\/app\/courses\/([\w-]+)$/))) return coursePage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/courses\/([\w-]+)\/compare$/))) return revisionComparePage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/courses\/([\w-]+)\/bank\.(csv|gift)$/))) return bankFileResponse(env, actor, match[1], match[2] as 'csv' | 'gift')
  if ((match = path.match(/^\/app\/sources\/([\w-]+)\/compare$/))) return sourceComparePage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/revisions\/([\w-]+)$/))) return revisionPage(env, actor, match[1], url)
  if (path === '/app/paths') return pathsPage(env, actor, url)
  if (path === '/app/manage') return managePage(env, actor, request, url)
  if ((match = path.match(/^\/app\/records\/([\w-]+)$/))) return recordPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/records\/([\w-]+)\/transcript$/))) return transcriptPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/records\/([\w-]+)\/transcript\.csv$/))) return transcriptCsvResponse(env, actor, match[1])
  if ((match = path.match(/^\/app\/records\/([\w-]+)\/transcript\.xlsx$/))) return transcriptXlsxResponse(env, actor, match[1])
  if ((match = path.match(/^\/app\/learn\/([\w-]+)$/))) return learnOverview(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/learn\/([\w-]+)\/lessons\/([\w-]+)$/))) return lessonPage(env, actor, match[1], match[2], url)
  if ((match = path.match(/^\/app\/learn\/([\w-]+)\/quiz$/))) return quizPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/learn\/([\w-]+)\/practical$/))) return practicalPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/attempts\/([\w-]+)$/))) return attemptPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/certificates\/([\w-]+)$/))) return certificatePage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/certificates\/([\w-]+)\.pdf$/))) return certificatePdfResponse(env, actor, match[1])
  if (path === '/app/certificate-templates') return templatesPage(env, actor, url)
  if (path === '/app/evidence') return evidencePage(env, actor, url)
  const cutover = path.match(/^\/app\/import\/cutover\/([\w-]+)$/)
  if (cutover) return cutoverPage(env,actor,cutover[1],url)
  if (path === '/app/import') return importPage(env, actor, url)
  if (path === '/app/reports') return reportPage(env, actor, url)
  if (path === '/app/coverage') return coveragePage(env, actor, url)
  if (path === '/app/quality') return qualityPage(env, actor, url)
  if (path === '/app/access') return accessPage(env, actor, url)
  if (path === '/app/skills') return skillsPage(env, actor, url)
  const skillsOf = path.match(/^\/app\/skills\/([\w-]+)$/)
  if (skillsOf) return personSkillsPage(env, actor, skillsOf[1], url)
  if (path === '/app/reports.csv') return reportCsvResponse(env, actor, url)
  if (path === '/app/reports.xlsx') return reportXlsxResponse(env, actor, url)
  if (path === '/app/audit') return auditPage(env, actor, url)
  if (path === '/app/announcements' && (isManager(actor) || actor.adminUnits.length || actor.instructor)) return announcementsPage(env, actor, url)
  if (path === '/app/notifications') return notificationsPage(env, actor, url)
  if (path === '/app/automation') return automationPage(env, actor, url)
  if (path === '/app/catalog') return catalogPage(env, actor, url)
  if (path === '/app/sessions') return sessionsPage(env, actor, url)
  if (path === '/app/external') return externalPage(env, actor, url)
  if (path === '/app/recognition') return recognitionPage(env, actor, url)
  if ((match = path.match(/^\/app\/discussions\/([\w-]+)$/))) return discussionsPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/sessions\/([\w-]+)\/roster$/))) return rosterPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/sessions\/([\w-]+)\/calendar\.ics$/))) return calendarResponse(env, actor, match[1])
  if (path === '/app/audit.csv') return auditCsvResponse(env, actor, url)
  if (path === '/app/diagnoses') return diagnosesPage(env, actor, url)
  if (path === '/app/agent') return agentPage(env, actor, url, (await business(env))!.timezone)
  if ((match = path.match(/^\/app\/practice\/([\w-]+)$/))) return practicePage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/questions\/([\w-]+)$/))) return questionsPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/files\/source\/([\w-]+)$/))) return sourceFile(env, actor, match[1], url.searchParams.has('download'))
  if ((match = path.match(/^\/app\/files\/attachment\/([\w-]+)$/))) return attachmentFile(env, actor, match[1])
  if ((match = path.match(/^\/app\/files\/external\/([\w-]+)$/))) return externalFile(env, actor, match[1])
  if ((match = path.match(/^\/app\/files\/discussion\/([\w-]+)$/))) return discussionFile(env, actor, match[1])
  throw new BeamError('not_found', 404)
}

// LIVE-001: a session's calendar file for its learners, instructor and schedulers.
async function calendarResponse(env: Bindings, actor: Actor, id: string) {
  const { session, cancelled } = await sessionForCalendar(env, actor, id)
  const body = sessionCalendar(session, cancelled, (await business(env))!.name, new URL(env.AUTH_ORIGIN).host)
  return new Response(body, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="session-${id}.ics"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}

// Active people for the rail and the footer, and the proposals this person can decide.
async function shellFacts(env: Bindings, actor: Actor) {
  const [people, zone, waiting] = await Promise.all([
    one<{ n: number }>(env, "SELECT COUNT(*) AS n FROM beam_members m WHERE EXISTS (SELECT 1 FROM oa_operators o WHERE o.id = m.operator_id AND o.status = 'active')"),
    business(env).then(value => value!.timezone),
    actor.owner || ['author', 'reviewer', 'manager'].some(role => actor.roles.has(role as never)) ? listProposals(env, actor).then(list => list.filter(item => item.canDecide).length) : 0,
  ])
  return { people: people?.n ?? 0, waiting, now: Date.now(), zone }
}

function redirect(env: Bindings, target: string, key: 'notice' | 'error', value: string) {
  const location = new URL(target, env.AUTH_ORIGIN)
  location.searchParams.set(key, value)
  return new Response(null, { status: 303, headers: { location: location.pathname + location.search, 'cache-control': 'no-store' } })
}
