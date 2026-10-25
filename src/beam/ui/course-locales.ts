import { collectLocaleSubtitles, localeSubtitleTextFields } from '../locale-subtitles'
import { localeTextFields } from '../course-locale-text'
// Editable externally prepared translations; no simulated AI generation or automatic language approval.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { localeView } from '../course-locales'
import { localeBaseDraft } from '../course-locale-validation'
import { one } from '../core'
import { area, card, form, h, hidden, rows, select, type Html } from './html'

export async function courseLocaleCards(env: Bindings, actor: Actor, course: string): Promise<Html> {
  const view = await localeView(env, actor, course), back = `/app/courses/${course}`
  const current = await one(env, 'SELECT published_revision_id FROM beam_courses WHERE id=?', course)
  if (!current?.published_revision_id) return card('Course languages', h`<p>Publish the original course before preparing another language.</p>`)
  const template = await localeBaseDraft(env, current.published_revision_id)
  const approved = view.glossaries.filter(glossary => glossary.approved_at)
  const subtitleOriginals = new Map(await Promise.all(view.translations.map(async item => [item.id, await collectLocaleSubtitles(env, actor, course, item.base_revision_id)] as const)))
  const originals = new Map(await Promise.all(view.translations.map(async item => [item.id, await localeBaseDraft(env, item.base_revision_id)] as const)))
  return h`${card('Course languages', h`<p>Prepare an alternate language from the exact published revision. Paste an externally prepared translation, review the glossary, and correct the draft before approval. Beam does not generate translations. The owner is the human language reviewer under the current conservative policy.</p>
<details><summary>Published source structure for translation</summary><div class="lesson-body"><label>Published translation structure<textarea readonly rows="14">${JSON.stringify(template, null, 2)}</textarea></label></div></details>
<details><summary>Import glossary terms</summary>${form('glossary.save', back, [hidden('course', course), select('Language', 'locale', [{ value: 'es-US', label: 'US Spanish' }, { value: 'en-US', label: 'US English' }]), area('Glossary JSON: source and target terms', 'terms', '[{"source":"","target":""}]')], 'Save glossary for review')}</details>
${view.glossaries.map(glossary => h`<section><h3>${glossary.locale} glossary</h3><dl>${glossary.terms.map((term: { source: string; target: string }) => h`<dt>${term.source}</dt><dd>${term.target}</dd>`)}</dl><p>${glossary.approved_at ? 'Approved for language review' : 'Awaiting owner review'}</p>${view.ownerReviews && !glossary.approved_at ? form('glossary.approve', back, [hidden('glossary', glossary.id), h`<label><input type="checkbox" name="confirm" value="yes" required> I reviewed and approve these terms.</label>`], 'Approve glossary') : ''}</section>`)}
${approved.length ? h`<p><a class="button secondary" href="/app/courses/${course}/translate">Translate with AI</a></p><details><summary>Import a prepared translation</summary>${form('locale.prepare', back, [hidden('course', course), hidden('baseRevision', current.published_revision_id), select('Language', 'locale', [{ value: 'es-US', label: 'US Spanish' }, { value: 'en-US', label: 'US English' }]), select('Approved glossary', 'glossary', approved.map(glossary => ({ value: glossary.id, label: `${glossary.locale} · ${glossary.id}` }))), area('Translation JSON', 'draft', JSON.stringify(template, null, 2))], 'Prepare editable translation')}</details>` : h`<p>Approve a glossary before preparing a translation.</p>`}`)}
${view.translations.map(item => card(`${item.locale} · ${item.state.replaceAll('_', ' ')}`, h`<p>Based on revision ${item.base_revision_id}. Approved translations retain their own immutable learning revision.</p>
<details><summary>Read the reviewed original</summary><dl>${localeTextFields(originals.get(item.id)!).map(field => h`<dt>${field.label}</dt><dd>${field.value}</dd>`)}</dl><dl>${subtitleOriginals.get(item.id)!.tracks.flatMap((track, t) => track.cues.map((cue, c) => h`<dt>Caption track ${t + 1}, cue ${c + 1} · ${cue.timing}</dt><dd>${cue.value}</dd>`))}</dl></details>
${item.state !== 'approved' ? form('locale.edit', back, [hidden('translation', item.id), hidden('version', item.version), ...localeTextFields(item.draft).map(field => area(field.label, field.key, field.value, false)), ...localeSubtitleTextFields(subtitleOriginals.get(item.id)!.tracks, JSON.parse(item.subtitles_json)).map(field => area(field.label, field.key, field.value, false))], 'Save corrected translation') : h`<p>Approved revision: ${item.revision_id}</p>`}
${item.state === 'draft' ? form('locale.submit', back, [hidden('translation', item.id), hidden('version', item.version)], 'Submit for language review') : ''}
${item.state === 'in_review' && view.ownerReviews ? h`<h3>Approve language revision</h3>${form('locale.approve', back, [hidden('translation', item.id), hidden('version', item.version), h`<label><input type="checkbox" name="glossaryReviewed" value="yes" required> I checked the approved glossary.</label><label><input type="checkbox" name="correctnessReviewed" value="yes" required> I reviewed the translation, captions, answer correctness and preserved sources.</label>`], 'Approve this language revision')}` : ''}`))}
${view.maintenance.length ? card('Language maintenance', rows(view.maintenance.map(item => ({ title: `${item.locale} · ${item.cause.replaceAll('_', ' ')}`, meta: `Approved language revision ${item.revision_id ?? 'not yet published'} requires review against the updated original. Earlier learning evidence stays unchanged.` })))) : ''}`
}
