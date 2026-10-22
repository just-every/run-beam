// Human-editable authored text; field paths are generated from the stored draft, never accepted from the client.
import type { Draft } from './courses'
import type { Input } from './input'

type TextField = { key: string; label: string; value: string; path: (string | number)[] }
export function localeTextFields(draft: Draft) {
  const fields: TextField[] = []
  const add = (label: string, path: (string | number)[]) => {
    const value = path.reduce<any>((node, key) => node?.[key], draft)
    if (typeof value === 'string') fields.push({ key: `locale_text_${fields.length}`, label, value, path })
  }
  add('Course title', ['title']); add('Course summary', ['summary'])
  draft.lessons.forEach((lesson, i) => {
    add(`Lesson ${i + 1} title`, ['lessons', i, 'title']); add(`Lesson ${i + 1} text`, ['lessons', i, 'body'])
    lesson.blocks?.forEach((block, b) => {
      const prefix = ['lessons', i, 'blocks', b]
      add(`Lesson ${i + 1}, block ${b + 1} text or caption`, [...prefix, 'text'])
      add(`Lesson ${i + 1}, block ${b + 1} feedback`, [...prefix, 'feedback'])
      block.choices?.forEach((_, c) => add(`Lesson ${i + 1}, block ${b + 1}, option ${c + 1}`, [...prefix, 'choices', c]))
    })
  })
  draft.questions.forEach((question, i) => {
    const q = question as any, prefix = ['questions', i]
    add(`Question ${i + 1}`, [...prefix, 'prompt'])
    add(`Question ${i + 1} assessor guidance`, [...prefix, 'guidance'])
    q.choices?.forEach((_: string, c: number) => add(`Question ${i + 1}, option ${c + 1}${q.correct?.includes(c) ? " (correct)" : ""}`, [...prefix, 'choices', c]))
    q.blanks?.forEach((answers: string[], b: number) => answers.forEach((_, a) => add(`Question ${i + 1}, blank ${b + 1}, accepted answer ${a + 1}`, [...prefix, 'blanks', b, a])))
    q.items?.forEach((_: string, n: number) => add(`Question ${i + 1}, correct position ${n + 1}`, [...prefix, 'items', n]))
    q.pairs?.forEach((_: unknown, n: number) => { add(`Question ${i + 1}, pair ${n + 1} left`, [...prefix, 'pairs', n, 'left']); add(`Question ${i + 1}, pair ${n + 1} right`, [...prefix, 'pairs', n, 'right']) })
  })
  if (draft.practical) add('Practical assessment instructions', ['practical', 'instructions'])
  draft.survey?.forEach((_, i) => add(`Survey question ${i + 1}`, ['survey', i, 'prompt']))
  return fields
}
export function editedLocaleText(draft: Draft, input: Input) {
  const updated = structuredClone(draft)
  for (const field of localeTextFields(updated)) {
    const parent = field.path.slice(0, -1).reduce<any>((node, key) => node[key], updated)
    parent[field.path.at(-1)!] = input.text(field.key, { max: 50_000, optional: true })
  }
  return updated
}
