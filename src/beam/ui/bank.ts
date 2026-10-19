// LEARN-016: the bank's import and export card on the course page, and the write-free preview of a GIFT or Aiken file.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { bankCsv, bankExport, bankGift, previewBank } from '../bank-import'
import type { Input } from '../input'
import { backLink, card, fileField, form, h, hidden, page, rows, select } from './html'

const FORMATS = [{ value: 'gift', label: 'GIFT (Moodle)' }, { value: 'aiken', label: 'Aiken' }]

export function bankCard(courseId: string) {
  return h`<details><summary>Import or export questions</summary><form method="post" action="/app/courses/${courseId}/bank/preview" enctype="multipart/form-data">${hidden('course', courseId)}${select('File format', 'format', FORMATS)}${fileField('Question file', 'file', { required: true, accept: '.gift,.txt,text/plain' })}<button type="submit">Preview the import</button></form>
<p class="muted">The preview writes nothing. Export the draft bank: <a href="/app/courses/${courseId}/bank.csv">CSV (every question)</a> · <a href="/app/courses/${courseId}/bank.gift">GIFT</a>.</p></details>`
}

export async function bankPreviewPage(env: Bindings, actor: Actor, courseId: string, input: Input, url: URL) {
  const preview = await previewBank(env, actor, input)
  const back = `/app/courses/${courseId}`
  const adding = preview.items.filter(item => item.question && !item.duplicate).length
  const body = h`${backLink(back, 'Course')}<h1>Question import preview</h1><p class="subtitle"><mark class="hl">This is a preview: nothing has been written.</mark> ${adding} to add, ${preview.items.filter(item => item.duplicate).length} already in the bank, ${preview.items.filter(item => !item.question).length} not imported.</p>
${card('Questions', rows(preview.items.map(item => ({
    title: `${item.number}. ${item.question?.prompt ?? item.source.split('\n')[0].slice(0, 120)}`,
    meta: h`${item.type}${item.duplicate ? ' · already in the bank, skipped' : ''}${item.losses.length ? h`<br>Not carried: ${item.losses.join('; ')}` : ''}`,
  }))))}
${adding ? card('Apply', form('bank.import', back, [hidden('course', courseId), hidden('draftVersion', preview.draftVersion), hidden('format', preview.format), hidden('text', preview.text)], `Add ${adding} ${adding === 1 ? 'question' : 'questions'} to the draft`)) : ''}`
  return page('Question import preview', actor, body, { url })
}

export async function bankFileResponse(env: Bindings, actor: Actor, courseId: string, format: 'csv' | 'gift') {
  const { questions } = await bankExport(env, actor, courseId)
  const body = format === 'csv' ? bankCsv(questions) : bankGift(questions)
  return new Response(body, { headers: { 'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="question-bank-${courseId}.${format === 'csv' ? 'csv' : 'gift'}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
