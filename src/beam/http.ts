// Beam's public doors: /app pages, /app/do/ACTION form posts, /api/beam JSON,
// and access-checked file downloads. Every request resolves the signed-in
// member first; private data is never served to a signed-out request.
import { runtimeBindings, type Bindings } from '../auth.server'
import { AuthError, safeReturnTo } from '../modules/operator-auth/index.mjs'
import { acknowledgmentDocument, acknowledgmentEvidence } from './acknowledgments'
import { issueAgentCredential, requireAgentScope } from './agent-credentials'
import { actions } from './actions'
import { currentActor, isManager, type Actor } from './actor'
import { BeamError, one } from './core'
import { listProposals } from './agent-work'
import { Input } from './input'
import { attachmentFile } from './learning'
import { business } from './people'
import { sourceFile } from './sources'
import { coursePage, coursesPage, revisionPage, sourcesPage } from './ui/authoring'
import { revisionComparePage, sourceComparePage } from './ui/history'
import { acknowledgmentPage } from './ui/acknowledgments'
import { certificatePage, dashboard, learnOverview, lessonPage, notFound, practicalPage, quizPage, recordPage } from './ui/learner'
import { attemptPage, businessPage, pathsPage, peoplePage } from './ui/managing'
import { managePage } from './ui/compliance'
import { importPage, previewPage } from './ui/movein'
import { agentPage } from './ui/agent'
import { evidencePage } from './ui/evidence'
import { practicePage, questionsPage } from './ui/practice'
import { reportCsvResponse, reportPage } from './ui/report'
import { auditCsvResponse, auditPage } from './ui/audit'
import { describeError, page, h } from './ui/html'
import { route } from './views'
import { VIEW_PAGES, VIEW_READS, exitView, startView, viewCookie, viewing } from './view-as'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })

function failure(error: unknown): { code: string; status: number; detail?: unknown } {
  if (error instanceof BeamError) return { code: error.code, status: error.status, detail: error.detail }
  if (error instanceof AuthError) return { code: error.code, status: error.status }
  const code = error instanceof Error ? error.message : ''
  if (/^(IMPORT_|PROVENANCE_|TARGET_|NATIVE_EDIT_CONFLICT|REVERSAL_)/.test(code)) return { code: code.split(/[:\s]/)[0].toLowerCase(), status: 409 }
  console.error('beam_internal_error', error)
  return { code: 'internal_error', status: 500 }
}

export async function beamResponse(request: Request, original: Bindings): Promise<Response | null> {
  const env = runtimeBindings(original)
  const url = new URL(request.url)
  const api = url.pathname.startsWith('/api/beam/')
  if (!api && url.pathname !== '/app' && !url.pathname.startsWith('/app/')) return null
  if (request.method === 'POST' && request.headers.get('origin') !== env.AUTH_ORIGIN) return api ? json({ error: 'invalid_origin' }, 403) : new Response('Forbidden', { status: 403 })
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD, POST' } })
  let actor: Actor | null = null
  try {
    actor = await currentActor(env, request)
    if (!actor) return api ? json({ error: 'authentication_required' }, 401) : Response.redirect(`${env.AUTH_ORIGIN}/signin?returnTo=${encodeURIComponent(url.pathname)}`, 303)
    actor = await viewing(env, request, actor) ?? actor
    const view = await viewDoor(env, actor, request, url, api)
    if (view) return view
    if (api) return await apiResponse(env, actor, request, url)
    return await pageResponse(env, actor, request, url)
  } catch (error) {
    const { code, status, detail } = failure(error)
    if (api) return json({ error: code, ...(detail === undefined ? {} : { detail }) }, status)
    if (status === 404) return notFound(actor)
    return page('Something went wrong', actor, h`<h1>That did not work</h1><p>${describeError(code).replace(/^./, letter => letter.toUpperCase())}</p><p><a href="/app/learning">Back to My learning</a></p>`, { status })
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
  requireAgentScope(actor, path, request.method)
  if (request.method === 'POST') {
    if (path === 'agent.issue') return json(await issueAgentCredential(env, actor, await Input.from(request)))
    const input = await Input.from(request)
    if (path === 'revision.decide' && input.text('decision') === 'publish') throw new BeamError('human_publication_form_required', 403)
    const action = actions[path]
    if (!action) throw new BeamError('not_found', 404)
    return json(await action(env, actor, input, request))
  }
  const source = path.match(/^source-files\/([\w-]+)$/)
  if (source) return sourceFile(env, actor, source[1], true)
  const { view, id } = route(path)
  return json(await view(env, actor, request, id))
}

async function pageResponse(env: Bindings, actor: Actor, request: Request, url: URL): Promise<Response> {
  const path = url.pathname
  if (request.method === 'POST') {
    if (path === '/app/import/preview') return await previewPage(env, actor, await Input.from(request), url)
    const name = path.match(/^\/app\/do\/([\w.]+)$/)?.[1]
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
      return redirect(env, returnTo.replace('/{id}', ''), 'error', code)
    }
  }
  // The owner names the business and its time zone before anything else.
  if (!await business(env)) {
    if (actor.owner) return path === '/app/business' ? businessPage(env, actor, url) : Response.redirect(`${env.AUTH_ORIGIN}/app/business`, 303)
    return page('Not ready', actor, h`<h1>Beam is not set up yet</h1><p>The owner needs to name the business first.</p>`)
  }
  actor.shell = await shellFacts(env, actor)
  let match: RegExpMatchArray | null
  // Sign-in lands on /app: people who manage training open on Manage, everyone else on My learning.
  if (path === '/app') return isManager(actor) ? Response.redirect(`${env.AUTH_ORIGIN}/app/manage${url.search}`, 303) : dashboard(env, actor, url)
  if (path === '/app/learning') return dashboard(env, actor, url)
  if (path === '/app/business') return businessPage(env, actor, url)
  if (path === '/app/people') return peoplePage(env, actor, request, url)
  if (path === '/app/sources') return sourcesPage(env, actor, url)
  if (path === '/app/courses') return coursesPage(env, actor, url)
  if ((match = path.match(/^\/app\/acknowledgments\/([\w-]+)$/))) return acknowledgmentPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/acknowledgments\/([\w-]+)\/document$/))) return acknowledgmentDocument(env, actor, match[1], url.searchParams.has('download'))
  if ((match = path.match(/^\/app\/acknowledgments\/([\w-]+)\/evidence$/))) return acknowledgmentEvidence(env, actor, match[1])
  if ((match = path.match(/^\/app\/courses\/([\w-]+)$/))) return coursePage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/courses\/([\w-]+)\/compare$/))) return revisionComparePage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/sources\/([\w-]+)\/compare$/))) return sourceComparePage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/revisions\/([\w-]+)$/))) return revisionPage(env, actor, match[1], url)
  if (path === '/app/paths') return pathsPage(env, actor, url)
  if (path === '/app/manage') return managePage(env, actor, request, url)
  if ((match = path.match(/^\/app\/records\/([\w-]+)$/))) return recordPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/learn\/([\w-]+)$/))) return learnOverview(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/learn\/([\w-]+)\/lessons\/([\w-]+)$/))) return lessonPage(env, actor, match[1], match[2], url)
  if ((match = path.match(/^\/app\/learn\/([\w-]+)\/quiz$/))) return quizPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/learn\/([\w-]+)\/practical$/))) return practicalPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/attempts\/([\w-]+)$/))) return attemptPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/certificates\/([\w-]+)$/))) return certificatePage(env, actor, match[1], url)
  if (path === '/app/evidence') return evidencePage(env, actor, url)
  if (path === '/app/import') return importPage(env, actor, url)
  if (path === '/app/reports') return reportPage(env, actor, url)
  if (path === '/app/reports.csv') return reportCsvResponse(env, actor, url)
  if (path === '/app/audit') return auditPage(env, actor, url)
  if (path === '/app/audit.csv') return auditCsvResponse(env, actor, url)
  if (path === '/app/agent') return agentPage(env, actor, url, (await business(env))!.timezone)
  if ((match = path.match(/^\/app\/practice\/([\w-]+)$/))) return practicePage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/questions\/([\w-]+)$/))) return questionsPage(env, actor, match[1], url)
  if ((match = path.match(/^\/app\/files\/source\/([\w-]+)$/))) return sourceFile(env, actor, match[1], url.searchParams.has('download'))
  if ((match = path.match(/^\/app\/files\/attachment\/([\w-]+)$/))) return attachmentFile(env, actor, match[1])
  throw new BeamError('not_found', 404)
}

// Active people for the rail and the footer, and the proposals this person can decide.
async function shellFacts(env: Bindings, actor: Actor) {
  const [people, zone, waiting] = await Promise.all([
    one<{ n: number }>(env, "SELECT COUNT(*) AS n FROM beam_members m WHERE EXISTS (SELECT 1 FROM oa_operators o WHERE lower(o.email) = m.email AND o.status = 'active')"),
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
