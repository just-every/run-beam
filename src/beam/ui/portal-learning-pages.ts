import { portalWrittenReviewFragment } from './portal-quiz-review'
import { portalAssessmentFragment } from './portal-assessment'
// External pages use the same authenticated portal doors, without employee actor resolution.
import type { Bindings } from '../../auth.server'
import { enterprisePortalResponse } from '../enterprise-portals'
import { one } from '../core'
import { portalFrame } from './enterprise-portals'
import { portalPracticalFragment } from './portal-practical'
import { renderBlocks } from './media'
import { h, card, hidden, lessonText, type Html } from './html'

const labels: Record<string, string> = { operatorName: 'Training operator', purpose: 'Learning purpose', collectedData: 'Identity and learning data', reportingRecipients: 'Who receives reports', providers: 'Services used', retentionAndHolds: 'Retention and holds', certificateEffects: 'Certificate consequences', withdrawal: 'Withdrawing consent' }
export async function enterprisePortalPage(env: Bindings, request: Request): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/portal/')) return null
  const match = url.pathname.match(/^\/portal\/([\w-]+)\/(claim|consent|learning|catalog|assessment|assessment-review|practical|practical-review|completion)$/)
  let branding: Parameters<typeof portalFrame>[3]
  const document = (title: string, body: Html, status = 200) => {
    const response = portalFrame(title, body, status, branding, false)
    response.headers.set('referrer-policy', 'same-origin')
    return request.method === 'HEAD' ? new Response(null, response) : response
  }
  if (!match) return document('Portal unavailable', h`<h1>Portal unavailable</h1>`, 404)
  const [, id, door] = match, base = `/portal/${id}`
  const target = new URL(url); target.pathname = `/api/beam/portal/${id}/${door}`
  const response = await enterprisePortalResponse(env, new Request(target.href, request))
  if (!response) return document('Portal unavailable', h`<h1>Portal unavailable</h1>`, 404)
  // HEAD authorizes through GET too, but must never return the resulting document body.
  const data = request.method === 'HEAD' && response.ok ? null : await response.json() as Record<string, any>
  if (request.method === 'HEAD' && response.ok) return document('Training portal', h``, response.status)
  if (!response.ok) return document('Portal access', h`<h1>Portal access</h1>${card('Access is closed', h`<p>${response.status === 401 ? 'Sign in with the account named by your invitation.' : 'This action is unavailable for your account or current consent.'}</p>${response.status === 401 ? h`<p><a href="/signin?returnTo=${encodeURIComponent(url.pathname + url.search)}">Sign in</a></p>` : h`<p><a href="${base}/consent">Review your consent</a></p>`}`)}`, response.status)
  const theme = await one(env, 'SELECT theme_json FROM beam_enterprise_portals WHERE id=?', id)
  branding = { base: `/app/portal/${id}`, theme: JSON.parse(theme!.theme_json), identity: door === 'claim' ? data!.identity : undefined }
  if (request.method === 'POST') return new Response(null, { status: 303, headers: { location: door === 'claim' ? `${base}/consent` : url.pathname + url.search, 'cache-control': 'no-store', 'referrer-policy': 'same-origin' } })
  const nav = h`<p class="actions"><a href="${base}/catalog">My portal learning</a><a href="${base}/consent">Consent settings</a></p>`
  if (door === 'claim') return document('Claim invitation', h`<h1>${data!.name}</h1>${card('Claim your invitation', h`<p>Connect this portal identity to your signed-in account. This does not accept consent or grant administrator access.</p><form method="post" action="${url.pathname}">${hidden('identity', data!.identity)}<button type="submit">Claim invitation</button></form>`)}`)
  if (door === 'consent') return document('Portal consent', h`<h1>${data!.name}</h1>${nav}${card('Your portal consent', h`<p role="status">${data!.accepted ? 'Consent accepted' : 'Consent not accepted'}${data!.accessClosed ? ' · Admission closed' : ''}</p><p>Notice version ${data!.noticeVersion}. Consent applies to this portal only.</p>${data!.notice ? Object.entries(labels).map(([key, label]) => h`<h3>${label}</h3>${lessonText(data!.notice[key])}`) : h`<p>The operator has not published a complete notice. Access remains closed.</p>`}${data!.accepted ? h`<form method="post" action="${url.pathname}">${hidden('withdraw', 'true')}<button type="submit" class="secondary">Withdraw consent</button></form>` : !data!.accessClosed && data!.notice ? h`<form method="post" action="${url.pathname}">${hidden('noticeVersion', data!.noticeVersion)}<label class="check"><input type="checkbox" name="accept" value="true" required> I have read this notice and consent to this portal's learning processing.</label><button type="submit">Accept portal notice</button></form>` : ''}`)}`)
  if (door === 'catalog') return document('Portal learning', h`<h1>${data!.name}</h1>${nav}${card('My enrolled learning', data!.enrollments.length ? data!.enrollments.map((enrollment: any) => h`<p><a href="${base}/learning?enrollment=${enrollment.id}">${data!.courses.find((course: any) => course.revision === enrollment.revision)?.title ?? 'Approved course revision'}</a></p>`) : h`<p>No enrolled learning is available. Contact this portal's administrator.</p>`)}`)
  if (door === 'completion') return document('Course completion', h`<h1>Course completion</h1>${nav}<p><a href="${base}/learning?enrollment=${data!.enrollment}">Back to enrolled lessons</a></p>${card('Your earned evidence', data!.completion ? h`<p role="status">Course completed</p><p>${data!.completion.title} · Revision ${data!.completion.revisionNumber}</p><p>Certificate ${data!.completion.number}</p><p><a href="/api/beam/portal/${id}/certificate.pdf?enrollment=${data!.enrollment}">Download my certificate</a></p>` : data!.qualified ? h`<p>All supported requirements of your enrolled revision are met.</p><form method="post" action="${url.pathname + url.search}">${hidden('enrollment', data!.enrollment)}<button type="submit">Record course completion</button></form>` : h`<p>Completion is unavailable until all revision requirements have qualified evidence. Some delivery methods are not available in this portal yet.</p>`)}`)
  if (door === 'practical' || door === 'practical-review') return document(door === 'practical' ? 'Practical assessment' : 'Review practical evidence', portalPracticalFragment(base, data! as any))
  if (door === 'assessment-review') return document('Assess written answers', portalWrittenReviewFragment(base, id, url, data!))
  if (door === 'assessment') return document('Portal assessment', portalAssessmentFragment(base, id, url, data!))
  return document(data!.revision.title, h`<h1>${data!.revision.title}</h1>${nav}<p>Revision ${data!.revision.number} · ${data!.lessonsRead} of ${data!.lessons.length} lessons read</p><p>Lesson progress is separate from assessment and earned completion.</p>${data!.lessons.map((lesson: any) => card(lesson.title, h`${lesson.available ? h`${lessonText(lesson.body)}${renderBlocks(lesson.blocks, [], 'en-US', { source: block => `/api/beam/portal/${id}/media?enrollment=${data!.enrollment}&lesson=${lesson.id}&block=${block.id}`, caption: block => `/api/beam/portal/${id}/media?enrollment=${data!.enrollment}&lesson=${lesson.id}&block=${block.id}&caption=1` })}` : h`<p>This lesson's media is not available in the portal yet.</p>`}${lesson.completedAt !== null ? h`<p role="status">Read recorded</p>` : lesson.available ? h`<form method="post" action="${url.pathname + url.search}">${hidden('enrollment', data!.enrollment)}${hidden('lesson', lesson.id)}<button type="submit">Mark lesson read</button></form>` : ''}`))}<p class="actions"><a href="${base}/assessment?enrollment=${data!.enrollment}">Take assessment</a><a href="${base}/practical?enrollment=${data!.enrollment}">Practical assessment</a><a href="${base}/completion?enrollment=${data!.enrollment}">Review course completion</a></p><p><a href="/api/beam/portal/${id}/progress.json?enrollment=${data!.enrollment}">Download my lesson progress</a></p>`)
}
