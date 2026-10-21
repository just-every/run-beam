import type { Block } from '../media'
import { BLOCK_KINDS } from '../media'
import { area, field, form, h, hidden, select } from './html'
const LABELS: Record<typeof BLOCK_KINDS[number], string> = { text: 'Rich text', image: 'Image', audio: 'Audio', video: 'Video', document: 'Document (PDF)', link: 'Link', check: 'Knowledge check', embed: 'Web content' }
export function blockEditor(course: string, draftVersion: number, lesson: string, blocks: Block[], sources: { value: string; label: string }[], reusable: { value: string; label: string }[]) {
  const back = `/app/courses/${course}`
  const base = [hidden('course', course), hidden('draftVersion', draftVersion), hidden('lesson', lesson)]
  const fields = (kind: Block['kind'], block?: Block) => [
    ...base, hidden('kind', kind), block ? hidden('block', block.id) : '',
    kind === 'text' ? area('Rich text (headings, lists, **bold**, _emphasis_ and `code`)', 'text', block?.text ?? '') : field(kind === 'image' ? 'Image description' : kind === 'check' ? 'Practice question' : 'Label', 'text', { value: block?.text ?? '' }),
    ['image', 'audio', 'video', 'document'].includes(kind) ? select('Source version', 'source', sources, block?.source ?? '', { blank: 'Choose an uploaded source' }) : '',
    ['embed', 'link'].includes(kind) ? field('HTTPS URL', 'url', { type: 'url', value: block?.url ?? '' }) : '',
    kind === 'check' ? [area('Choices, one per line', 'choices', block?.choices?.join('\n') ?? ''), field('Correct choice number', 'answer', { type: 'number', value: (block?.answer ?? 0) + 1 }), area('Explanation', 'feedback', block?.feedback ?? '', false)] : '',
  ]
  return h`<h3>Media blocks</h3><p class="muted">Blocks follow the lesson text. Upload owned or licensed media in Sources; source versions stay with the published lesson.</p>${blocks.map((block, index) => h`<details><summary>${index + 1}. ${LABELS[block.kind]} · ${block.text.slice(0, 80)}</summary>${form('course.block', back, fields(block.kind, block), 'Save block')}${['up', 'down', 'duplicate', 'remove'].map(operation => form('course.block.change', back, [...base, hidden('block', block.id), hidden('operation', operation)], { up: 'Move block up', down: 'Move block down', duplicate: 'Duplicate block', remove: 'Remove block' }[operation]!, { secondary: true }))}</details>`)}
<details><summary>Add a media block</summary>${BLOCK_KINDS.map(kind => h`<details><summary>${LABELS[kind]}</summary>${form('course.block', back, fields(kind), 'Add block')}</details>`)}</details>
${reusable.length ? h`<details><summary>Reuse a block</summary>${form('course.block.reuse', back, [...base, select('Block from your courses', 'from', reusable)], 'Reuse block', { secondary: true })}</details>` : ''}`
}
