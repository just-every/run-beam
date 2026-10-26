import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all } from '../core'
import { tutorList, tutorQuestion, tutorPreview, tutorCitation } from '../tutor'
import { modelAccount } from '../model-account'
import { listSources } from '../sources'
import { area, backLink, card, form, h, hidden, page, select } from './html'

export async function tutorPage(env: Bindings, actor: Actor, url: URL, id?: string) {
 const assignment = url.searchParams.get('assignment') ?? undefined
 const here = id ? `/app/tutor/${id}` : `/app/tutor${assignment ? `?assignment=${assignment}` : ''}`
 if (!id) {
  const items = await tutorList(env, actor, assignment)
  const courses = actor.owner ? await all(env, 'SELECT id,title FROM beam_courses ORDER BY title') : []
  const sources = actor.owner ? await listSources(env,actor) : []
  const grants = actor.owner ? await all(env, 'SELECT g.*,s.title FROM beam_tutor_grants g JOIN beam_source_versions v ON v.id=g.source_version_id JOIN beam_sources s ON s.id=v.source_id') : []
  return page('Learning questions', actor, h`${backLink(assignment ? `/app/learn/${assignment}` : '/app/business',assignment ? 'Back to learning' : 'Settings')}<h1>Learning questions</h1>
${assignment ? card('Ask from permitted company material',h`<p>Answers quote exact published lessons and explicitly shared company passages. Questions never count toward completion or employee ratings.</p>${form('tutor.ask','/app/tutor/{id}',[hidden('assignment',assignment),area('Your policy question','question'),h`<label class="check"><input type="checkbox" name="consent" value="yes" required> Share this question with the owner for one paid model request. The owner reviews the exact question and permitted passages before sending them to OpenAI. Avoid personal or confidential details.</label>`],'Submit question')}`) : card('Company source permissions',h`<p>Only the owner shares company material with a course cohort. Revocation closes stored tutor answers and citation reads immediately. Published lessons remain governed by their assignment.</p>${form('tutor.source',here,[select('Course','course',courses.map(c=>({value:c.id,label:c.title}))),select('Source version','source',sources.flatMap(s=>s.versions.map((v:any)=>({value:v.id,label:`${s.title} · version ${v.number}`})))),hidden('enabled','yes')],'Grant source access')}
<ul>${grants.map(g=>h`<li>${g.title} · ${g.enabled ? 'Shared' : 'Revoked'}${g.enabled ? form('tutor.source',here,[hidden('course',g.course_id),hidden('source',g.source_version_id)],'Revoke source access',{secondary:true}) : ''}</li>`)}</ul>`) }
${card(assignment ? 'Your questions' : 'Requests awaiting owner approval',h`<ul>${items.map(item=>h`<li><a href="/app/tutor/${item.id}">${item.question}</a> · ${item.answered ? 'Result available' : 'Waiting for owner approval'}</li>`)}</ul>`)}`,{current:assignment ? '/app/learning' : '/app/business',url})
 }
 const view = await tutorQuestion(env,actor,id)
 const account = actor.owner ? await modelAccount(env,actor) : null
 const preview = actor.owner && !view.result && account?.enabled ? await tutorPreview(env,actor,id) : null
 const citation = url.searchParams.get('passage')
 const passage = citation ? await tutorCitation(env,actor,id,citation) : null
 return page('Learning question',actor,h`${backLink(actor.owner ? '/app/tutor' : `/app/tutor?assignment=${view.assignment}`,'All learning questions')}<h1>Learning question</h1><p class="lede">${view.question}</p><p>${view.title} · revision ${view.revisionNumber}</p>
${passage ? card('Exact cited passage',h`<p>${passage.title ?? view.title} · ${passage.location}</p><blockquote>${passage.text}</blockquote><p>Revision ${passage.sourceVersion ?? passage.revision}</p><a href="/app/tutor/${id}/citation?passage=${passage.id}">Download cited passage</a>`) : ''}
${view.result ? card(view.result.status === 'answered' ? 'Source-grounded answer' : 'Unanswered question',h`<p>${view.result.uncertainty}</p>${view.result.citations.map((p:any)=>h`<section><blockquote>${p.text}</blockquote><p><a href="${here}?passage=${p.id}">${p.title ?? view.title} · ${p.location} · exact citation</a></p><p>Revision ${p.sourceVersion ?? p.revision}</p></section>`)}`) : card('Waiting for owner approval',h`<p>No answer is available yet. The employer owner must approve this exact paid request.</p>`) }
${actor.id === view.learner ? card('Ask the responsible expert',view.thread ? h`<p><a href="/app/discussions/${view.course}#thread-${view.thread}">Read the expert discussion</a></p>` : h`<p>This posts your named question to the course cohort and responsible experts, using the ordinary discussion privacy rules. Nothing is sent until you choose to post.</p>${form('tutor.handoff',here,hidden('question',id),'Post question to expert')}`) : ''}
${actor.owner && !account?.enabled ? h`<p><a href="/app/model-account">Enable the employer model account in Settings</a></p>` : ''}
${preview ? card('Review one paid tutor request',h`<p>OpenAI · ${preview.model} · conservative estimate USD ${(preview.estimateCents/100).toFixed(2)} · approved maximum USD ${(preview.maxCostCents/100).toFixed(2)}. These are estimates, not invoices or a provider billing cap.</p><p>Only the question, exact assigned revision and passages shown below leave this installation for api.openai.com. Provider terms and retention apply; Beam erasure does not prove provider erasure. Failed calls can be billed. There is no automatic retry. Approval expires in fifteen minutes; source grants, enrollment and account changes require fresh approval.</p><h3>Question to send</h3><p>${preview.payload.question}</p><h3>Permitted passages to send</h3>${preview.payload.passages.map(p=>h`<section><p>${p.title ?? view.title} · ${p.location}</p><blockquote>${p.text}</blockquote></section>`)}${form('tutor.run',here,[hidden('question',id),hidden('approval',preview.approval),hidden('estimateCents',preview.estimateCents),hidden('maxCostCents',preview.maxCostCents),h`<label class="check"><input type="checkbox" name="consent" value="yes" required> I authorize this exact tutor request once, with this disclosed payload and USD reservation.</label>`],'Approve tutor request')}`) : ''}`,{current:actor.owner ? '/app/business' : '/app/learning',url})
}
export async function tutorDownload(env: Bindings,actor: Actor,id:string,url:URL) {
 const p = await tutorCitation(env,actor,id,url.searchParams.get('passage') ?? '')
 return new Response(`${p.location}\nRevision ${p.sourceVersion ?? p.revision}\n\n${p.text}`,{headers:{'content-type':'text/plain; charset=utf-8','content-disposition':'attachment; filename="cited-passage.txt"','cache-control':'private, no-store','x-content-type-options':'nosniff'}})
}
