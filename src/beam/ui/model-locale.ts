import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { localeView } from '../course-locales'
import { Input } from '../input'
import { localeModelPreview } from '../model-locale'
import { modelAccount } from '../model-account'
import { backLink, card, form, h, hidden, page, select } from './html'
import { modelUsd } from './model-account'
export async function localeModelPage(env: Bindings, actor: Actor, course: string, url: URL) {
  const view = await localeView(env, actor, course), back = `/app/courses/${course}`, here = `${back}/translate`
  const glossaries = view.glossaries.filter(row => row.approved_at)
  const glossary = url.searchParams.get('glossary'), locale = glossaries.find(row => row.id === glossary)?.locale
  const owner = actor.owner && !actor.agent && !actor.app && !actor.viewAs
  const account = owner ? await modelAccount(env, actor) : null
  const input = Input.of({ course, baseRevision: view.baseRevision, glossary, locale })
  const preview = account?.enabled && glossary && locale ? await localeModelPreview(env, actor, input) : null
  return page('Translate course with AI', actor, h`${backLink(back, 'Back to course')}<h1>Translate course with AI</h1>
    ${card('Choose reviewed glossary', h`<p>The original published revision stays unchanged. Translate course text, quiz answers and timed subtitle cues into an editable language draft.</p>
    <form method="get" action="${here}">${select('Approved language glossary', 'glossary', glossaries.map(row => ({ value: row.id, label: `${row.locale} · ${row.terms.map((term: any) => term.target).join(', ')}` })), glossary ?? '')}<button>Review translation request</button></form>`)}
    ${!owner ? card('Owner approval required', h`<p>The human owner approves each paid request. Authors correct the resulting draft before human language review.</p>`) : !account?.enabled ? card('Connect model account', h`<p><a href="/app/model-account">Enable the employer's model account and cost limit</a></p>`) : ''}
    ${preview ? card('Approve one translation request', h`<p>OpenAI · ${preview.model}. Conservative reservation ${modelUsd(preview.estimateCents)}; approved maximum ${modelUsd(preview.maxCostCents)}. This is an estimate, not an invoice or provider billing cap.</p>
    <p>The exact published course text, questions, approved glossary and subtitle cue text leave this installation for api.openai.com. Media files are not sent. Provider account terms and retention apply; Beam erasure does not prove provider erasure. Failed and interrupted calls may be billed. No automatic retry occurs.</p>
    <details><summary>Inspect text sent for translation</summary><dl>${preview.fields.map(field => h`<dt>${field.label}</dt><dd>${field.value}</dd>`)}</dl></details>
    ${form('locale.model.run', back, [hidden('course', course), hidden('baseRevision', view.baseRevision!), hidden('glossary', glossary!), hidden('locale', locale!), hidden('approval', preview.approval), hidden('estimateCents', preview.estimateCents), hidden('maxCostCents', preview.maxCostCents), h`<label class="check"><input type="checkbox" name="consent" value="yes" required> I authorize this exact text and glossary to be sent once at the disclosed USD estimate and maximum. I will review the translation and captions before approving a language revision.</label><p>Approval expires after fifteen minutes. Source, revision, glossary or account changes require a fresh approval.</p>`], 'Approve and translate editable draft')}`) : ''}`, { current: '/app/courses', url })
}
