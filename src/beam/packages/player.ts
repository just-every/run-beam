import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { insist, one } from '../core'
import { page, h, card, backLink, rows } from '../ui/html'
import { playbackSession, runtimeEvidence } from './runtime'

export async function packagePlayer(env: Bindings, actor: Actor, id: string, url: URL) {
  const saved = await one(env, 'SELECT s.*,r.assignment_id FROM beam_package_sessions s LEFT JOIN beam_package_runs r ON r.id=s.run_id WHERE s.id=?', id)
  insist(saved && saved.actor_id === actor.id && saved.auth_session_id === actor.sessionId, 'not_found', 404)
  const assignment = saved.assignment_id && await one(env, 'SELECT status FROM beam_assignments WHERE id=?', saved.assignment_id)
  if (saved.ended_at || assignment && assignment.status !== 'open') return Response.redirect(`${env.AUTH_ORIGIN}${saved.preview ? `/app/courses/${(await one(env, 'SELECT course_id FROM beam_packages WHERE id=?', saved.package_id))!.course_id}` : `/app/learn/${saved.assignment_id}`}`, 303)
  const { session, pkg, sco, run } = await playbackSession(env, id, actor)
  const back = run ? `/app/learn/${run.assignment_id}` : `/app/courses/${pkg.course_id}`
  const asset = `/beam-package/${id}/${sco.launch.split('/').map(encodeURIComponent).join('/').replaceAll('%3F', '?').replaceAll('%23', '#')}`
  const response = page(sco.title, actor, h`${backLink(back, session.preview ? 'Back to course editor' : 'Back to course')}<h1>${sco.title}</h1><p>${pkg.title} · SCORM ${pkg.standard}${session.preview ? ' · Preview: training is not recorded' : ''}</p><section class="card" data-package-player data-session="${id}" data-version="${session.version}" data-preview="${session.preview}" data-back="${back}"><p role="status" data-package-status>${session.preview ? 'Preview ready.' : 'Ready. Use the package’s Save or Exit control before leaving.'}</p><iframe title="${sco.title}" src="${asset}" sandbox="allow-scripts" referrerpolicy="no-referrer" class="package-frame"></iframe><p><a class="button secondary" href="${back}">Return to course</a></p></section>`, { current: session.preview ? '/app/courses' : '/app/learning', url, script: '/beam-package-player.js' })
  response.headers.set('content-security-policy', response.headers.get('content-security-policy') + "; frame-src 'self'; connect-src 'self'")
  response.headers.set('referrer-policy', 'no-referrer')
  return response
}
export async function packageEvidencePage(env: Bindings, actor: Actor, assignment: string, url: URL) {
  const evidence = await runtimeEvidence(env, actor, assignment)
  return page('Package runtime evidence', actor, h`${backLink(`/app/learn/${assignment}`, 'Back to course')}<h1>Package runtime evidence</h1>${evidence.runs.map(run => card('Recorded runtime', h`<p>Total time: ${run.total_time} seconds · ${run.version} saves</p><dl>${Object.entries(run.state).map(([key, value]) => h`<dt>${key}</dt><dd>${value}</dd>`)}</dl>`))}${card('Raw runtime events', rows(evidence.events.map(event => ({ title: event.event, meta: JSON.stringify(event.values) }))))}`, { current: '/app/learning', url })
}
