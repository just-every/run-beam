import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { courseDetail } from '../courses'
import { Input } from '../input'
import { modelAccount } from '../model-account'
import { courseModelPreview } from '../model-course'
import { listSources } from '../sources'
import { requireCourseRole } from '../units'
import { backLink, card, form, h, hidden, page, raw } from './html'

const usd = (cents: number) => `USD ${(cents / 100).toFixed(2)}`
export async function courseModelPage(env: Bindings, actor: Actor, courseId: string, url: URL) {
  await requireCourseRole(env, actor, courseId, 'author')
  const [course, sources] = await Promise.all([courseDetail(env, actor, courseId), listSources(env, actor)])
  const selected = url.searchParams.getAll('inputs'), back = `/app/courses/${courseId}`, here = `${back}/generate`
  const owner = actor.owner && !actor.agent && !actor.app && !actor.viewAs
  const account = owner ? await modelAccount(env, actor) : null
  const preview = selected.length && account?.enabled ? await courseModelPreview(env, actor, courseId, Input.of({ inputs: selected })) : null
  return page('Draft from company documents', actor, h`${backLink(back, 'Back to course editor')}<h1>Draft from company documents</h1><p class="lede">Prepare an outline, objectives, lessons and quiz questions for ${course.title}. A proposed change waits for a person to apply it to the editable draft and send it for the named human review.</p>
${card('Choose company documents', h`<form method="get" action="${here}"><fieldset><legend>Source versions to use (up to four)</legend>${sources.map(source => h`<h3>${source.title}</h3>${source.versions.map((version: any) => h`<label class="check"><input type="checkbox" name="inputs" value="${version.id}"${selected.includes(version.id) ? raw(' checked') : ''}> Version ${version.number} · ${version.filename}</label>`)}`)}</fieldset><button>Review selected sources and cost</button></form><p>Use documents your employer is authorized to send. Scanned sources need OCR first. Source instructions are treated as untrusted text; attempted instructions and missing facts are shown for review.</p>`)}
${!owner ? card('Owner approval required', h`<p>The human owner configures the employer's model account and approves each paid request. Share this selected-source page with the owner. You can review and edit the resulting proposal in the course editor.</p>`) : !account?.enabled ? card('Connect the employer model account', h`<p>No request has been sent. The owner must enable the account and approve its USD limit before generating a draft.</p><p><a href="/app/model-account">Model account and cost controls</a></p>`) : ''}
${preview ? card('Review one paid request', h`<p>Provider: OpenAI · model ${preview.model}. Declared conservative estimate: <strong>${usd(preview.estimateCents)}</strong>; approved maximum: <strong>${usd(preview.maxCostCents)}</strong>. Estimates are not invoices or a provider billing limit.</p><p>The selected extracted passages, uncertainty notes and current course title will leave this installation for api.openai.com. Provider account terms and retention apply. Erasing Beam's copy does not prove provider erasure. Failed or interrupted calls can be billed; no automatic retry occurs.</p><p>Draft version ${preview.draftVersion} · ${preview.passages} source passages.</p><ul>${preview.sources.map(source => h`<li><a href="${source.original}" target="_blank" rel="noopener noreferrer">${source.title}</a><br>Version ${source.id}<br>SHA-256 ${source.sha256}</li>`)}</ul>
${preview.uncertainties.length ? h`<h3>Source uncertainties to compare with the originals</h3><ul>${preview.uncertainties.map(issue => h`<li>${issue.location}: ${issue.reason}</li>`)}</ul>` : ''}
${form('course.model.run', back, [hidden('course', courseId), ...preview.inputs.map(id => hidden('inputs', id)), hidden('approval', preview.approval), hidden('estimateCents', preview.estimateCents), hidden('maxCostCents', preview.maxCostCents), h`<label class="check"><input type="checkbox" name="consent" value="yes" required> I authorize this exact selected-source request once at the disclosed estimate and maximum. I will compare the proposal with the originals before applying it.</label><p>Approval expires after fifteen minutes. Author changes or account changes require a fresh approval. Generated lessons and questions are added to existing draft content only when a person applies the proposal.</p>`], 'Approve and generate proposed draft')}`) : ''}`, { current: '/app/courses', url })
}
