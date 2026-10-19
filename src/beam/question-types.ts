// Quiz question types: BEAM-07 multiple choice and the LEARN-015 fill-in-the-blank, ordering and matching. Each type
// has its stored shape, its author form fields, the learner's answer as read from a form or JSON, its scoring (one
// point only when every choice, blank, position or pair is right) and what the learner is shown, which never
// includes the answer. Questions stored before LEARN-015 have no kind and are multiple choice.
import { insist, newId } from './core'
import type { Input } from './input'

export interface ChoiceQuestion { id: string; kind?: 'choice'; prompt: string; choices: string[]; correct: number[] }
/** Each blank lists its accepted answers. Spaces at both ends of an answer are always ignored; ignoreCase also
 * compares letters case-insensitively, for every blank of the question. */
export interface BlankQuestion { id: string; kind: 'blank'; prompt: string; blanks: string[][]; ignoreCase: boolean }
/** Items in their correct order. */
export interface OrderQuestion { id: string; kind: 'order'; prompt: string; items: string[] }
/** Each left item with the right item it pairs with. */
export interface MatchQuestion { id: string; kind: 'match'; prompt: string; pairs: { left: string; right: string }[] }
export type Question = ChoiceQuestion | BlankQuestion | OrderQuestion | MatchQuestion
/** Selected choice numbers (choice), typed text per blank (blank), the item placed at each position (order) or the
 * right item chosen for each left item (match); -1 is an empty position or pair. */
export type Answer = number[] | string[]

export const KINDS = ['choice', 'blank', 'order', 'match'] as const
export const kindOf = (question: Question) => question.kind ?? 'choice'
export const SCORING_RULE = 'one point per question only when every choice, blank, position or pair is correct; blanks accept any listed answer, ignoring spaces at both ends, and case where the question says so'

const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() !== '' && value.length <= max
const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean)

/** Validates a stored question (draft JSON) and returns its clean shape. */
export function normaliseQuestion(question: any): Question {
  insist(question && text(question.prompt, 1000), 'invalid_question')
  const id = typeof question.id === 'string' && question.id ? question.id : newId(), prompt = question.prompt.trim()
  const kind = question.kind ?? 'choice'
  if (kind === 'blank') {
    insist(Array.isArray(question.blanks) && question.blanks.length >= 1 && question.blanks.length <= 10 && question.blanks.every((accepted: unknown) => Array.isArray(accepted) && accepted.length >= 1 && accepted.length <= 10 && accepted.every(answer => text(answer, 200))), 'invalid_question_answer')
    return { id, kind, prompt, blanks: question.blanks.map((accepted: string[]) => accepted.map(answer => answer.trim())), ignoreCase: question.ignoreCase === true }
  }
  if (kind === 'order') {
    insist(Array.isArray(question.items) && question.items.length >= 2 && question.items.length <= 10 && question.items.every((item: unknown) => text(item, 300)) && new Set(question.items.map((item: string) => item.trim())).size === question.items.length, 'invalid_question')
    return { id, kind, prompt, items: question.items.map((item: string) => item.trim()) }
  }
  if (kind === 'match') {
    insist(Array.isArray(question.pairs) && question.pairs.length >= 2 && question.pairs.length <= 10 && question.pairs.every((pair: any) => pair && text(pair.left, 300) && text(pair.right, 300)), 'invalid_question')
    const pairs = question.pairs.map((pair: { left: string; right: string }) => ({ left: pair.left.trim(), right: pair.right.trim() }))
    insist(new Set(pairs.map((pair: { left: string }) => pair.left)).size === pairs.length && new Set(pairs.map((pair: { right: string }) => pair.right)).size === pairs.length, 'invalid_question')
    return { id, kind, prompt, pairs }
  }
  insist(kind === 'choice', 'invalid_question_kind')
  insist(Array.isArray(question.choices) && question.choices.length >= 2 && question.choices.length <= 8 && question.choices.every((choice: unknown) => text(choice, 300)), 'invalid_question')
  insist(Array.isArray(question.correct) && question.correct.length >= 1 && question.correct.every((index: number) => Number.isInteger(index) && index >= 0 && index < question.choices.length) && new Set(question.correct).size === question.correct.length, 'invalid_question_answer')
  return { id, prompt, choices: question.choices.map((choice: string) => choice.trim()), correct: [...question.correct].sort((a: number, b: number) => a - b) }
}

/** The author's form or JSON: `kind` plus choices/correct, answers (one line per blank, variants split by |), items
 * (one per line, in order) or pairs (one `left = right` per line). */
export function questionFromInput(input: Input): Question {
  const id = input.text('question', { optional: true }) || newId(), prompt = input.text('prompt', { max: 1000 })
  const kind = input.text('kind', { optional: true }) || 'choice'
  if (kind === 'blank') return normaliseQuestion({ id, kind, prompt, blanks: lines(input.text('answers', { max: 3000 })).map(line => line.split('|').map(answer => answer.trim()).filter(Boolean)), ignoreCase: input.has('ignoreCase') })
  if (kind === 'order') return normaliseQuestion({ id, kind, prompt, items: lines(input.text('items', { max: 3000 })) })
  if (kind === 'match') return normaliseQuestion({ id, kind, prompt, pairs: lines(input.text('pairs', { max: 6000 })).map(line => { const at = line.indexOf('='); return at < 0 ? { left: line, right: '' } : { left: line.slice(0, at), right: line.slice(at + 1) } }) })
  const choices = lines(input.text('choices', { max: 3000 }))
  const correct = input.text('correct', { max: 40 }).split(/[\s,]+/).filter(Boolean).map(value => Number(value) - 1)
  return normaliseQuestion({ id, kind, prompt, choices, correct })
}

/** Form field names of one question's answer. */
const field = (question: Question, part?: number) => part === undefined ? `q_${question.id}` : `q_${question.id}_${part}`
const parts = (question: Question) => question.kind === 'blank' ? question.blanks.length : question.kind === 'order' ? question.items.length : question.kind === 'match' ? question.pairs.length : 0

/** Whether the input carries any part of this question's answer. */
export function answered(question: Question, input: Input) {
  const count = parts(question)
  return count ? Array.from({ length: count }, (_, part) => input.has(field(question, part))).some(Boolean) : input.has(field(question))
}

/** The learner's answer to one question, checked against the question's shape. */
export function answerFrom(question: Question, input: Input): Answer {
  if (question.kind === 'blank') return question.blanks.map((_, part) => input.text(field(question, part), { optional: true, max: 200 }) ?? '')
  if (question.kind === 'order' || question.kind === 'match') {
    const size = parts(question)
    return Array.from({ length: size }, (_, part) => {
      const value = input.text(field(question, part), { optional: true, max: 4 })
      const index = value === undefined || value === '' ? -1 : Number(value)
      insist(Number.isInteger(index) && index >= -1 && index < size, 'invalid_answer')
      return index
    })
  }
  const selected = [...new Set(input.list(field(question)).map(Number))].sort((a, b) => a - b)
  insist(selected.every(index => Number.isInteger(index) && index >= 0 && index < question.choices.length), 'invalid_answer')
  return selected
}

const same = (question: BlankQuestion, a: string, b: string) => {
  const shape = (value: string) => question.ignoreCase ? value.trim().toLowerCase() : value.trim()
  return shape(a) === shape(b)
}

/** One point only when the whole answer is right; a missing answer scores none. */
export function isCorrect(question: Question, answer: Answer | undefined): boolean {
  if (!answer) return false
  if (question.kind === 'blank') return question.blanks.every((accepted, part) => typeof answer[part] === 'string' && accepted.some(option => same(question, option, answer[part] as string)))
  if (question.kind === 'order' || question.kind === 'match') return answer.length === parts(question) && answer.every((value, position) => value === position)
  return answer.length === question.correct.length && answer.every((value, index) => value === question.correct[index])
}

const alphabetical = (values: string[]) => values.map((label, index) => ({ index, label })).sort((a, b) => a.label.localeCompare(b.label) || a.index - b.index)

/** What the learner sees of a question: never which answer is right. Ordering items and matching options are listed
 * alphabetically, so their order says nothing about the answer. */
export function presentQuestion(question: Question) {
  if (question.kind === 'blank') return { id: question.id, kind: question.kind, prompt: question.prompt, blanks: question.blanks.length }
  if (question.kind === 'order') return { id: question.id, kind: question.kind, prompt: question.prompt, positions: question.items.length, options: alphabetical(question.items) }
  if (question.kind === 'match') return { id: question.id, kind: question.kind, prompt: question.prompt, lefts: question.pairs.map(pair => pair.left), options: alphabetical(question.pairs.map(pair => pair.right)) }
  return { id: question.id, kind: 'choice' as const, prompt: question.prompt, choices: question.choices, multiple: question.correct.length > 1 }
}
export type PresentedQuestion = ReturnType<typeof presentQuestion>

/** The answer key as text, for revision comparison. */
export function answerText(question: Question) {
  if (question.kind === 'blank') return [...question.blanks.map((accepted, part) => `[blank ${part + 1}] ${accepted.join(' | ')}`), question.ignoreCase ? 'case ignored' : 'case must match'].join('\n')
  if (question.kind === 'order') return question.items.map((item, position) => `[${position + 1}] ${item}`).join('\n')
  if (question.kind === 'match') return question.pairs.map(pair => `${pair.left} = ${pair.right}`).join('\n')
  return question.choices.map((choice, index) => `${question.correct.includes(index) ? '[correct] ' : ''}${choice}`).join('\n')
}

/** The author's form values for an existing question. */
export function formValues(question: Question) {
  if (question.kind === 'blank') return { answers: question.blanks.map(accepted => accepted.join(' | ')).join('\n'), ignoreCase: question.ignoreCase }
  if (question.kind === 'order') return { items: question.items.join('\n') }
  if (question.kind === 'match') return { pairs: question.pairs.map(pair => `${pair.left} = ${pair.right}`).join('\n') }
  return { choices: question.choices.join('\n'), correct: question.correct.map(index => index + 1).join(',') }
}
