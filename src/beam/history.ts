// Course and source history (AUTHOR-004): compare two course revisions lesson by
// lesson and rule by rule, compare two versions of a source, and restore an
// earlier revision into the editable draft. Restoring only rewrites the draft;
// revisions, assignments, attempts and completions are never touched, and the
// restored content publishes as a new revision through ordinary review.
import type { Bindings } from '../auth.server'
import { requireRole, type Actor } from './actor'
import { editDraft, revisionDetail, type Draft, type Question } from './courses'
import { insist, one, sha256Hex, type Row } from './core'
import { answerText } from './question-types'
import { diffLines } from './diff'
import type { Input } from './input'

type Lesson = { position: number; title: string; body: string; sources: string[] }

/** Pairs lessons by title in order (an LCS on titles); unpaired lessons were added or removed. */
function pairLessons(from: Lesson[], to: Lesson[]) {
  const width = to.length + 1
  const table = new Uint32Array((from.length + 1) * width)
  for (let i = from.length - 1; i >= 0; i--) for (let j = to.length - 1; j >= 0; j--)
    table[i * width + j] = from[i].title === to[j].title ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
  const pairs: { from: Lesson | null; to: Lesson | null }[] = []
  let i = 0, j = 0
  while (i < from.length || j < to.length) {
    if (i < from.length && j < to.length && from[i].title === to[j].title) pairs.push({ from: from[i++], to: to[j++] })
    else if (i < from.length && (j === to.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) pairs.push({ from: from[i++], to: null })
    else pairs.push({ from: null, to: to[j++] })
  }
  return pairs
}

const lessonRef = (lesson: Lesson | null) => lesson ? { position: lesson.position + 1, title: lesson.title } : null
const choiceText = (question: Question) => answerText(question)

export async function compareRevisions(env: Bindings, actor: Actor, fromId: string, toId: string) {
  requireRole(actor, 'author', 'reviewer', 'manager')
  insist(fromId && toId, 'revisions_required')
  const [from, to] = await Promise.all([revisionDetail(env, fromId), revisionDetail(env, toId)])
  insist(from.revision.course_id === to.revision.course_id, 'revisions_from_different_courses')
  const side = (detail: typeof from) => ({ id: detail.revision.id, number: detail.revision.number, state: detail.revision.state })
  const lessons = pairLessons(from.lessons, to.lessons).map(pair => {
    const change = !pair.from ? 'added' : !pair.to ? 'removed' : pair.from.body === pair.to.body && pair.from.sources.join() === pair.to.sources.join() ? (pair.from.position === pair.to.position ? 'same' : 'moved') : 'changed'
    const before = pair.from?.sources ?? [], after = pair.to?.sources ?? []
    return { change, from: lessonRef(pair.from), to: lessonRef(pair.to), body: diffLines(pair.from?.body ?? '', pair.to?.body ?? ''), sources: { added: after.filter(id => !before.includes(id)), removed: before.filter(id => !after.includes(id)) } }
  })
  const fromQuestions = from.assessment?.questions ?? [], toQuestions = to.assessment?.questions ?? []
  const questions = [
    ...fromQuestions.map(question => {
      const next = toQuestions.find(item => item.id === question.id)
      const change = !next ? 'removed' : next.prompt === question.prompt && choiceText(next) === choiceText(question) ? 'same' : 'changed'
      return { change, prompt: { from: question.prompt, to: next?.prompt ?? null }, choices: diffLines(choiceText(question), next ? choiceText(next) : '') }
    }),
    ...toQuestions.filter(question => !fromQuestions.some(item => item.id === question.id)).map(question => ({ change: 'added', prompt: { from: null, to: question.prompt }, choices: diffLines('', choiceText(question)) })),
  ]
  const rule = (name: string, a: unknown, b: unknown) => ({ name, from: a ?? null, to: b ?? null, changed: (a ?? null) !== (b ?? null) })
  const rules = [
    rule('passPercent', from.assessment?.pass_percent, to.assessment?.pass_percent),
    rule('maxAttempts', from.assessment?.max_attempts, to.assessment?.max_attempts),
    rule('timeLimitMinutes', from.assessment?.time_limit_minutes, to.assessment?.time_limit_minutes),
    rule('practicalAssessor', from.assessment?.assessor_id, to.assessment?.assessor_id),
  ]
  return {
    course: from.revision.course_id, from: side(from), to: side(to),
    details: [rule('title', from.revision.title, to.revision.title), rule('summary', from.revision.summary, to.revision.summary)],
    lessons,
    assessment: { rules, practical: diffLines(from.assessment?.practical_instructions ?? '', to.assessment?.practical_instructions ?? ''), questions },
    changed: lessons.some(item => item.change !== 'same') || questions.some(item => item.change !== 'same') || rules.some(item => item.changed),
  }
}

const TEXT_LIMIT = 1_000_000

async function sourceText(env: Bindings, version: Row) {
  if (version.media_type !== 'text/plain' || version.size > TEXT_LIMIT) return null
  const object = await env.FILES.get(`sha256/${version.sha256}`)
  insist(object, 'file_missing', 503)
  const bytes = new Uint8Array(await object.arrayBuffer())
  insist(bytes.length === version.size && await sha256Hex(bytes) === version.sha256, 'file_integrity', 503)
  return new TextDecoder().decode(bytes)
}

/** Two versions of one source: their recorded facts, and a line comparison when both are text. */
export async function compareSourceVersions(env: Bindings, actor: Actor, fromId: string, toId: string) {
  requireRole(actor, 'author', 'reviewer', 'manager')
  insist(fromId && toId, 'versions_required')
  const [from, to] = await Promise.all([fromId, toId].map(id => one(env, 'SELECT v.*, s.title FROM beam_source_versions v JOIN beam_sources s ON s.id = v.source_id WHERE v.id = ?', id)))
  insist(from && to, 'source_version_not_found', 404)
  insist(from.source_id === to.source_id, 'versions_from_different_sources')
  const side = (version: Row) => ({ id: version.id, number: version.number, filename: version.filename, mediaType: version.media_type, size: version.size, sha256: version.sha256, provenance: version.provenance, uploadedBy: version.uploaded_by, uploadedAt: version.uploaded_at })
  const [before, after] = await Promise.all([sourceText(env, from), sourceText(env, to)])
  return {
    source: from.source_id, title: from.title, from: side(from), to: side(to),
    sameBytes: from.sha256 === to.sha256,
    text: before !== null && after !== null ? diffLines(before, after) : null,
    textNote: before !== null && after !== null ? null : 'Line comparison covers text files up to 1 MB; these versions are compared by their recorded file facts and SHA-256 digests.',
  }
}

/** Replaces the draft with an earlier revision's content; the draft-version check refuses a stale restore. */
export const restoreRevision = (env: Bindings, actor: Actor, input: Input) => editDraft(env, actor, input, 'course.restore', async draft => {
  const detail = await revisionDetail(env, input.text('revision'))
  insist(detail.revision.course_id === input.text('course'), 'revision_not_found', 404)
  const restored: Draft = {
    title: detail.revision.title,
    summary: detail.revision.summary,
    lessons: detail.lessons.map(lesson => ({ id: '', title: lesson.title, body: lesson.body, sources: lesson.sources })),
    questions: detail.assessment?.questions ?? [],
    passPercent: detail.assessment?.pass_percent ?? null,
    maxAttempts: detail.assessment?.max_attempts ?? null,
    timeLimitMinutes: detail.assessment?.time_limit_minutes ?? null,
    practical: detail.assessment?.practical_instructions ? { instructions: detail.assessment.practical_instructions, assessor: detail.assessment.assessor_id } : null,
  }
  Object.assign(draft, restored)
}, { revision: input.text('revision') })
