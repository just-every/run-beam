// LEARN-016: GIFT and Aiken question files into a course's LEARN-001 bank. Parsing writes nothing: the preview lists
// each question with the Beam type it becomes and names everything the file says that Beam cannot carry. Applying adds
// the questions to the draft (the named reviewer publishes them as usual), skipping any question already in the bank.
// The bank exports to CSV (every question) and GIFT (the types GIFT can say).
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { BeamError, insist } from './core'
import { editDraft, loadCourse } from './courses'
import { requireCourseRole } from './units'
import type { Input } from './input'
import { answerText, kindOf, normaliseQuestion, weightOf, type Question } from './question-types'

export type Format = 'gift' | 'aiken'
export interface Parsed { number: number; type: string; question: Question | null; losses: string[]; source: string }

const LIMIT = 500_000

/** The file's text and format from an upload (`file`) or a carried preview (`text`). */
export async function sourceFrom(input: Input): Promise<{ format: Format; text: string }> {
  const format = input.text('format') as Format
  insist(format === 'gift' || format === 'aiken', 'invalid_format')
  const file = await input.file('file', { optional: true, maxBytes: LIMIT })
  const text = file ? new TextDecoder().decode(file.bytes) : input.text('text', { max: LIMIT })
  return { format, text: text.replace(/^﻿/, '').replace(/\r\n?/g, '\n') }
}

export const parseBank = (format: Format, text: string) => format === 'gift' ? parseGift(text) : parseAiken(text)

/** Same question = same type, prompt, answer key, weight and always-asked mark (ids aside). */
export const sameQuestion = (question: Question) => `${kindOf(question)}\n${question.prompt}\n${answerText(question)}`

/** Validates one mapped question; a shape Beam refuses (too many choices, say) is skipped with the reason named. */
function carry(number: number, type: string, raw: Record<string, unknown>, losses: string[], source: string): Parsed {
  try { return { number, type, question: normaliseQuestion(raw), losses, source } }
  catch (error) {
    if (!(error instanceof BeamError)) throw error
    return { number, type, question: null, losses: [...losses, `not imported: Beam cannot hold this ${type} question as written (${error.message.replace(/_/g, ' ')})`], source }
  }
}

// GIFT (Moodle). Escapes \~ \= \# \{ \} \: and \n; // comment lines; blank lines between questions.
const unescape = (value: string) => value.replace(/\\n/g, '\n').replace(/\\([~=#{}:\\])/g, '$1').trim()
/** Index of the next unescaped character from `chars` at or after `from`, or -1. */
function next(text: string, chars: string, from = 0) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue }
    if (chars.includes(text[i])) return i
  }
  return -1
}

/** Beam's own GIFT export marks a question's weight, always-asked and case rule in its title: [3 points, always asked]. */
function titleMarks(title: string, losses: string[]) {
  const marks = title.match(/\[([^\]]*)\]\s*$/)?.[1] ?? ''
  const points = Number(marks.match(/(\d+) points?/)?.[1] ?? 1)
  const rest = title.replace(/\[[^\]]*\]\s*$/, '').trim()
  if (rest && !/^Q\d+$/.test(rest)) losses.push(`question title “${rest}” is not kept`)
  return { points, always: /always asked/.test(marks), caseMatters: /case must match/.test(marks) }
}

export function parseGift(text: string): Parsed[] {
  const blocks = text.split('\n').filter(line => !line.trim().startsWith('//')).join('\n').split(/\n\s*\n/).map(block => block.trim()).filter(Boolean)
  const parsed: Parsed[] = []
  for (const [index, block] of blocks.entries()) {
    const number = index + 1, losses: string[] = []
    if (/^\$CATEGORY:/i.test(block)) { parsed.push({ number, type: 'category', question: null, losses: [`category “${block.slice(10).trim()}” is not kept: questions join this course's bank`], source: block }); continue }
    let rest = block, title = ''
    if (rest.startsWith('::')) {
      const end = rest.indexOf('::', 2)
      if (end > 0) { title = unescape(rest.slice(2, end)); rest = rest.slice(end + 2).trim() }
    }
    const marks = titleMarks(title, losses)
    const format = rest.match(/^\[(html|moodle|plain|markdown)\]/i)?.[1].toLowerCase()
    if (format) {
      rest = rest.slice(format.length + 2).trim()
      if (format === 'html' || format === 'markdown') losses.push(`[${format}] formatting is not kept: the text is imported as plain text`)
    }
    const open = next(rest, '{'), close = open < 0 ? -1 : next(rest, '}', open + 1)
    if (open < 0 || close < 0) { parsed.push({ number, type: 'description', question: null, losses: ['not imported: a description with no answers is not a question'], source: block }); continue }
    let before = unescape(rest.slice(0, open)), after = unescape(rest.slice(close + 1))
    if (format === 'html') { before = before.replace(/<[^>]+>/g, ''); after = after.replace(/<[^>]+>/g, '') }
    const prompt = after ? `${before} ___ ${after}` : before
    const weight = { points: marks.points, always: marks.always }
    let body = rest.slice(open + 1, close).trim()
    // General feedback (####) and per-answer feedback (#) are not carried, except an essay's general feedback, which
    // becomes the assessor's guidance.
    let general = ''
    const generalAt = body.indexOf('####')
    if (generalAt >= 0) { general = unescape(body.slice(generalAt + 4)); body = body.slice(0, generalAt).trim() }
    if (!body) { parsed.push(carry(number, 'essay → free response', { kind: 'text', prompt, guidance: general, ...weight }, losses, block)); continue }
    if (general) losses.push('general feedback is not kept')
    const truth = body.match(/^(TRUE|FALSE|T|F)\b/i)
    if (truth) {
      if (next(body, '#') >= 0) losses.push('answer feedback is not kept')
      parsed.push(carry(number, 'true/false → multiple choice', { kind: 'choice', prompt, choices: ['True', 'False'], correct: [truth[1].toUpperCase().startsWith('T') ? 0 : 1], ...weight }, losses, block))
      continue
    }
    if (body.startsWith('#')) {
      const answers = answerParts(body.slice(1), losses)
      const values = answers.length ? answers.map(answer => answer.text) : [unescape(body.slice(1))]
      const tolerances = values.filter(value => /:|\.\./.test(value))
      if (tolerances.length) losses.push(`numeric tolerance (${tolerances.join(', ')}) is not checked automatically: the named assessor grades the answer`)
      else losses.push('numeric answers are not checked automatically: the named assessor grades the answer')
      parsed.push(carry(number, 'numeric → free response', { kind: 'text', prompt, guidance: `Expected answer: ${values.join(' or ')}`, ...weight }, losses, block))
      continue
    }
    const answers = answerParts(body, losses)
    if (answers.some(answer => answer.mark === '=' && /->/.test(answer.text))) {
      parsed.push(carry(number, 'matching', { kind: 'match', prompt, pairs: answers.map(answer => { const [left, right] = answer.text.split(/\s*->\s*/); return { left: left ?? '', right: right ?? '' } }), ...weight }, losses, block))
      continue
    }
    if (answers.every(answer => answer.mark === '=')) {
      if (answers.some(answer => answer.weight !== null && answer.weight < 100)) losses.push('partial credit is not kept: only full-credit answers are accepted')
      const accepted = answers.filter(answer => answer.weight === null || answer.weight >= 100).map(answer => answer.text)
      parsed.push(carry(number, 'short answer → fill-in-the-blank', { kind: 'blank', prompt, blanks: [accepted], ignoreCase: !marks.caseMatters, ...weight }, losses, block))
      continue
    }
    // With an "=" answer it is one right answer; without one, every answer with a positive %weight% is right.
    const single = answers.some(answer => answer.mark === '=')
    const correct = answers.map((answer, i) => (single ? answer.mark === '=' : (answer.weight ?? 0) > 0) ? i : -1).filter(i => i >= 0)
    const multiple = !single
    if (single && answers.some(answer => answer.mark === '~' && (answer.weight ?? 0) > 0)) losses.push('partial credit is not kept: only the right answer scores')
    if (multiple && new Set(answers.filter(answer => (answer.weight ?? 0) > 0).map(answer => answer.weight)).size > 1) losses.push('unequal answer weights are not kept: every right answer must be chosen')
    if (answers.some(answer => answer.weight !== null && answer.weight < 0 && answer.weight > -100)) losses.push('partial negative marks are not kept: choosing a wrong answer makes the whole answer wrong')
    parsed.push(carry(number, multiple ? 'multiple answer → multiple choice' : 'multiple choice', { kind: 'choice', prompt, choices: answers.map(answer => answer.text), correct, ...weight }, losses, block))
  }
  return parsed
}

/** The =/~ answers of a GIFT answer block, each with its %weight% (null when none); feedback is dropped and named. */
function answerParts(body: string, losses: string[]) {
  const answers: { mark: string; weight: number | null; text: string }[] = []
  let at = next(body, '=~')
  if (at < 0 && body.trim()) return [{ mark: '=', weight: null, text: unescape(body) }]
  while (at >= 0) {
    const end = next(body, '=~', at + 1)
    let part = body.slice(at + 1, end < 0 ? undefined : end)
    const mark = body[at]
    const feedback = next(part, '#')
    if (feedback >= 0) { if (!losses.includes('answer feedback is not kept')) losses.push('answer feedback is not kept'); part = part.slice(0, feedback) }
    const weighted = part.match(/^\s*%(-?\d+(?:\.\d+)?)%/)
    answers.push({ mark, weight: weighted ? Number(weighted[1]) : null, text: unescape(weighted ? part.slice(weighted[0].length) : part) })
    at = end
  }
  return answers
}

// Aiken: a question line, options "A." or "A)", then "ANSWER: X". Always single-answer multiple choice.
export function parseAiken(text: string): Parsed[] {
  const parsed: Parsed[] = []
  let prompt: string[] = [], options: string[] = [], lines: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    lines.push(raw)
    const option = line.match(/^([A-Z])[.)]\s+(.*)$/)
    const answer = line.match(/^ANSWER:\s*([A-Z])\s*$/i)
    if (answer) {
      const number = parsed.length + 1, index = answer[1].toUpperCase().charCodeAt(0) - 65
      parsed.push(index < options.length && prompt.length
        ? carry(number, 'multiple choice', { kind: 'choice', prompt: prompt.join(' '), choices: options, correct: [index] }, [], lines.join('\n'))
        : { number, type: 'multiple choice', question: null, losses: ['not imported: the ANSWER letter names no option'], source: lines.join('\n') })
      prompt = []; options = []; lines = []
    } else if (option && prompt.length) options.push(option[2].trim())
    else if (options.length) options[options.length - 1] += ` ${line}`
    else prompt.push(line)
  }
  if (lines.length) parsed.push({ number: parsed.length + 1, type: 'multiple choice', question: null, losses: ['not imported: no ANSWER line'], source: lines.join('\n') })
  return parsed
}

/** What applying would do, without writing: each question marked new or already in the bank. */
export async function previewBank(env: Bindings, actor: Actor, input: Input) {
  const courseId = input.text('course')
  await requireCourseRole(env, actor, courseId, 'author')
  const course = await loadCourse(env, courseId)
  const { format, text } = await sourceFrom(input)
  const known = new Set(course.draft.questions.map(sameQuestion))
  const items = parseBank(format, text).map(item => ({ ...item, duplicate: !!item.question && known.has(sameQuestion(item.question)) }))
  insist(items.length > 0, 'bank_file_empty')
  return { course: courseId, draftVersion: course.draft_version, format, text, items }
}

/** Adds the file's new questions to the draft bank, in file order; questions already in the bank are skipped. */
export async function importBank(env: Bindings, actor: Actor, input: Input) {
  const { format, text } = await sourceFrom(input)
  const items = parseBank(format, text)
  let added = 0, duplicates = 0
  const result = await editDraft(env, actor, input, 'course.bank.import', draft => {
    const known = new Set(draft.questions.map(sameQuestion))
    for (const item of items) {
      if (!item.question) continue
      const key = sameQuestion(item.question)
      if (known.has(key)) { duplicates++; continue }
      known.add(key)
      draft.questions.push(item.question)
      added++
    }
  }, { format, questions: items.length, losses: items.flatMap(item => item.losses.map(loss => `${item.number}: ${loss}`)) })
  return { ...result, added, duplicates, skipped: items.filter(item => !item.question).length }
}

const giftText = (value: string) => value.replace(/([~=#{}:\\])/g, '\\$1').replace(/\n/g, '\\n')

/** The draft bank as GIFT. Ordering questions and questions with several blanks have no GIFT form: they are listed as
 * comments naming them, and the CSV export carries them. */
export function bankGift(questions: Question[]) {
  return questions.map((question, index) => {
    const marks = [`${weightOf(question)} ${weightOf(question) === 1 ? 'point' : 'points'}`, ...(question.always ? ['always asked'] : []), ...(question.kind === 'blank' && !question.ignoreCase ? ['case must match'] : [])]
    const head = `::Q${index + 1} [${marks.join(', ')}]::${giftText(question.prompt)}`
    if (question.kind === 'text') return `${head} {${question.guidance ? `####${giftText(question.guidance)}` : ''}}`
    if (question.kind === 'match') return `${head} {\n${question.pairs.map(pair => `  =${giftText(pair.left)} -> ${giftText(pair.right)}`).join('\n')}\n}`
    if (question.kind === 'blank' && question.blanks.length === 1) return `${head} {${question.blanks[0].map(answer => `=${giftText(answer)}`).join(' ')}}`
    if (question.kind === 'blank' || question.kind === 'order') return `// Q${index + 1} not exported: GIFT has no ${question.kind === 'order' ? 'ordering' : 'several-blank'} question (see the CSV export): ${question.prompt.replace(/\n/g, ' ')}`
    if (question.correct.length === 1) return `${head} {\n${question.choices.map((choice, i) => `  ${i === question.correct[0] ? '=' : '~'}${giftText(choice)}`).join('\n')}\n}`
    const share = Number((100 / question.correct.length).toFixed(5))
    return `${head} {\n${question.choices.map((choice, i) => `  ~%${question.correct.includes(i) ? share : -100}%${giftText(choice)}`).join('\n')}\n}`
  }).join('\n\n') + '\n'
}

const csvCell = (value: unknown) => { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text }

/** The draft bank as CSV: one row per question with its type, prompt, weight, always-asked mark and answer key. */
export function bankCsv(questions: Question[]) {
  return [['Number', 'Type', 'Prompt', 'Points', 'Always asked', 'Answer key'], ...questions.map((question, index) => [index + 1, kindOf(question), question.prompt, weightOf(question), question.always ? 'yes' : 'no', answerText(question).split('\n').slice(1).join('\n')])]
    .map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** The draft bank for its course's authors. */
export async function bankExport(env: Bindings, actor: Actor, courseId: string) {
  await requireCourseRole(env, actor, courseId, 'author')
  const course = await loadCourse(env, courseId)
  return { title: course.draft.title as string, questions: course.draft.questions as Question[] }
}
