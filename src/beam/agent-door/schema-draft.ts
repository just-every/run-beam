import type { JsonSchema } from '../../modules/agent-door/index.ts'
import { array, choice, flag, id, integer, nullable, object, text } from './schema.ts'

// Every supported native draft field is described here. In particular, a proposal
// cannot smuggle a provider action or a publication decision inside opaque JSON.
const table = (depth = 1): JsonSchema => array(array(object({
  text: text(5000, 0), colSpan: integer(1, 30), rowSpan: integer(1, 100), header: flag,
  ...(depth < 4 ? { tables: array(object({ text: text(10_000), table: table(depth + 1) }), 1000) } : {}),
}, ['text', 'colSpan', 'rowSpan', 'header']), 30), 100, 1)

const copiedFrom = object({ course: id, lesson: id, block: id, courseTitle: text(160, 0), lessonTitle: text(160, 0) }, ['course', 'lesson', 'block'])
const attribution = { id, copiedFrom }
const caption = object({ source: id, language: text(100), label: text(100) })
const common = { text: text(10_000), ...attribution }
const block = (kind: string, fields: Record<string, JsonSchema> = {}, required: string[] = []): JsonSchema => object({ kind: { const: kind }, ...common, ...fields }, ['kind', 'text', ...required])
export const blockSchema: JsonSchema = { oneOf: [
  block('text'),
  block('image', { source: id, asset: text(100) }, ['source']),
  block('audio', { source: id }, ['source']),
  block('video', { source: id, captions: caption }, ['source']),
  block('document', { source: id }, ['source']),
  block('link', { url: text(2000) }, ['url']),
  block('embed', { url: text(2000) }, ['url']),
  block('check', { choices: array(text(500), 8, 2), answer: integer(0, 7), feedback: text(2000, 0) }, ['choices', 'answer', 'feedback']),
  block('table', { table: table() }, ['table']),
  // Native keepsTools permits retaining previously human-attached LTI resources.
  // course.block refuses this kind; complete draft proposals may retain it.
  block('lti', { resource: id, passPercent: integer(1, 100) }, ['resource', 'passPercent']),
] }

const weighted = { id, prompt: text(1000), points: integer(1, 100), always: flag }
const question = (kind: string, fields: Record<string, JsonSchema>, required: string[]): JsonSchema => object({ kind: { const: kind }, ...weighted, ...fields }, ['kind', 'prompt', ...required])
export const questionSchema: JsonSchema = { oneOf: [
  object({ ...weighted, kind: { const: 'choice' }, choices: array(text(300), 8, 2), correct: array(integer(0, 7), 8, 1) }, ['prompt', 'choices', 'correct']),
  question('blank', { blanks: array(array(text(200), 10, 1), 10, 1), ignoreCase: flag }, ['blanks', 'ignoreCase']),
  question('order', { items: array(text(300), 10, 2) }, ['items']),
  question('match', { pairs: array(object({ left: text(300), right: text(300) }), 10, 2) }, ['pairs']),
  question('text', { guidance: text(2000, 0) }, []),
] }
const lesson = object({ id, title: text(160), body: text(50_000, 0), sources: array(id), blocks: array(blockSchema, 60) }, ['title', 'body', 'sources'])
const sequence = object({
  workStart: integer(0, 23), workEnd: integer(1, 24), workDays: array(integer(0, 6), 7, 1),
  days: array(object({ lesson: id, prompt: text(500), choices: array(object({ label: text(160), feedback: text(1000), next: choice('retry', 'continue') }), 4, 2) }), 5, 5),
}, ['workStart', 'workEnd', 'days'])
export const draftSchema = object({
  title: text(160), summary: text(1000, 0), lessons: array(lesson, 60), questions: array(questionSchema, 60),
  passPercent: nullable(integer(1, 100)), maxAttempts: nullable(integer(1, 20)), timeLimitMinutes: nullable(integer(1, 600)),
  practical: nullable(object({ instructions: text(5000), assessor: id })), attendancePercent: nullable(integer(1, 100)),
  drawCount: nullable(integer(1, 60)), shuffle: flag, feedback: choice('attempt', 'final', 'score'), assessor: nullable(id),
  survey: array(object({ id, kind: choice('rating', 'text'), prompt: text(500) }, ['kind', 'prompt']), 10),
  packages: array(id, 20), xapiActivities: array(id, 20), sequence,
}, ['title', 'summary', 'lessons', 'questions'])

export const passages = array(object({ sourceVersion: id, quote: text(1000), lesson: text(160, 0) }, ['sourceVersion', 'quote']), 50)
export const draftProposal = { course: id, draftVersion: integer(1, 1_000_000), summary: text(2000), draft: draftSchema, inputs: array(id), passages, missing: array(text(300), 20) }
