import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { editDraft, loadCourse } from './courses'
import { insist, newId } from './core'
import type { Input } from './input'
import { normaliseBlocks } from './media'
import { requireCourseRole } from './units'
import { fillTableCells } from './table-traversal'

// PACK-006: an external-tool block enters a draft only through the owner's lti.attach, for a resource selected for the
// same course; these doors never add or copy one. Duplicating, moving and removing within the course stay open.
const ATTACH_ONLY = 'lti_attach_required'

export async function saveBlock(env: Bindings, actor: Actor, input: Input) {
  await requireCourseRole(env, actor, input.text('course'), 'author')
  const table = input.has('tableShape') ? fillTableCells(input.json('tableShape'), input.list('tableCells', { keepEmpty: true })) : undefined
  const value = input.has('content') ? input.json('content') : {
    table, asset: input.text('asset', { optional: true }) || undefined, kind: input.text('kind'), text: input.text('text', { max: 10_000 }), source: input.text('source', { optional: true }), url: input.text('url', { max: 2000, optional: true }),
    captions: input.has('captionSource') ? { source: input.text('captionSource'), language: input.text('captionLanguage', { max: 100 }), label: input.text('captionLabel', { max: 100 }) } : undefined,
    choices: input.text('choices', { max: 4000, optional: true }).split('\n').filter(Boolean), answer: (input.integer('answer', { min: 1, max: 8, optional: true }) ?? 1) - 1, feedback: input.text('feedback', { max: 2000, optional: true }),
  }
  insist((value as { kind?: unknown } | null)?.kind !== 'lti', ATTACH_ONLY, 403)
  const [block] = await normaliseBlocks(env, [value], { admit: true })
  return editDraft(env, actor, input, 'course.block', draft => {
    const lesson = draft.lessons.find(item => item.id === input.text('lesson'))
    insist(lesson, 'lesson_not_found', 404)
    const blocks = lesson.blocks ??= []
    const id = input.text('block', { optional: true })
    if (id) {
      const index = blocks.findIndex(item => item.id === id)
      insist(index >= 0, 'block_not_found', 404)
      blocks[index] = { ...block, id, copiedFrom: blocks[index].copiedFrom }
    } else blocks.push({ ...block, id: newId() })
  })
}
export async function changeBlock(env: Bindings, actor: Actor, input: Input) {
  return editDraft(env, actor, input, 'course.block.change', async draft => {
    const lesson = draft.lessons.find(item => item.id === input.text('lesson'))
    const blocks = lesson?.blocks
    const index = blocks?.findIndex(item => item.id === input.text('block')) ?? -1
    insist(blocks && index >= 0, 'block_not_found', 404)
    const operation = input.text('operation')
    if (operation === 'remove') blocks.splice(index, 1)
    else if (operation === 'duplicate') {
      await normaliseBlocks(env, [blocks[index]], { admit: true, course: input.text('course') })
      blocks.splice(index + 1, 0, { ...structuredClone(blocks[index]), id: newId(), copiedFrom: blocks[index].copiedFrom ?? { course: input.text('course'), lesson: input.text('lesson'), block: blocks[index].id, courseTitle: draft.title, lessonTitle: lesson!.title } })
    } else {
      insist(operation === 'up' || operation === 'down', 'invalid_block_operation')
      const target = operation === 'up' ? index - 1 : index + 1
      if (target >= 0 && target < blocks.length) [blocks[index], blocks[target]] = [blocks[target], blocks[index]]
    }
  })
}
export async function reuseBlock(env: Bindings, actor: Actor, input: Input) {
  const from = input.text('from', { max: 650 }).split(':')
  insist(from.length === 3, 'invalid_block_reference')
  await requireCourseRole(env, actor, from[0], 'author')
  const sourceCourse = await loadCourse(env, from[0])
  const source = sourceCourse.draft.lessons.find(item => item.id === from[1])
  const block = source?.blocks?.find(item => item.id === from[2])
  insist(block, 'block_not_found', 404)
  insist(block.kind !== 'lti', ATTACH_ONLY, 403)
  await normaliseBlocks(env, [block], { admit: true })
  return editDraft(env, actor, input, 'course.block.reuse', draft => {
    const target = draft.lessons.find(item => item.id === input.text('lesson'))
    insist(target, 'lesson_not_found', 404)
    ;(target.blocks ??= []).push({ ...structuredClone(block), id: newId(), copiedFrom: block.copiedFrom ?? { course: from[0], lesson: from[1], block: from[2], courseTitle: sourceCourse.title, lessonTitle: source!.title } })
    target.sources = [...new Set([...target.sources, ...(source?.sources ?? [])])]
  })
}
