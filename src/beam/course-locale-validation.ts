// Translation may change language, never the reviewed learning structure or required evidence.
import type { Bindings } from '../auth.server'
import { normaliseDraft, revisionDetail, type Draft } from './courses'
import { insist } from './core'
import { kindOf } from './question-types'

export async function localeBaseDraft(env: Bindings, revision: string): Promise<Draft> {
  const source = await revisionDetail(env, revision), a = source.assessment
  return {
    sequence: source.sequence ?? undefined,
    title: source.revision.title, summary: source.revision.summary,
    lessons: source.lessons.map(l => ({ id: l.id, title: l.title, body: l.body, sources: l.sources, blocks: l.blocks })),
    questions: a?.questions ?? [], passPercent: a?.pass_percent ?? null, maxAttempts: a?.max_attempts ?? null,
    timeLimitMinutes: a?.time_limit_minutes ?? null, practical: a?.practical_instructions ? { instructions: a.practical_instructions, assessor: a.assessor_id } : null,
    attendancePercent: source.revision.attendance_percent ?? null, drawCount: a?.draw_count ?? null,
    shuffle: a?.shuffle === 1, feedback: a?.feedback ?? 'attempt', assessor: a?.practical_instructions ? null : a?.assessor_id ?? null, survey: source.survey,
  }
}
function tableStructure(table: NonNullable<NonNullable<Draft['lessons'][number]['blocks']>[number]['table']>): unknown {
  return table.map(row => row.map(({ text, tables, ...cell }) => ({ ...cell, ...(tables ? { tables: tables.map(nested => ({ table: tableStructure(nested.table) })) } : {}) })))
}
function structure(draft: Draft) {
  return {
    sequence: draft.sequence ? { workStart: draft.sequence.workStart, workEnd: draft.sequence.workEnd, workDays: draft.sequence.workDays, days: draft.sequence.days.map(day => ({ lesson: day.lesson, branches: day.choices.map(choice => choice.next) })) } : null,
    passPercent: draft.passPercent, maxAttempts: draft.maxAttempts, timeLimitMinutes: draft.timeLimitMinutes,
    attendancePercent: draft.attendancePercent, drawCount: draft.drawCount, shuffle: draft.shuffle,
    feedback: draft.feedback, assessor: draft.assessor, practical: draft.practical?.assessor ?? null,
    lessons: draft.lessons.map(lesson => ({ id: lesson.id, sources: lesson.sources,
      blocks: (lesson.blocks ?? []).map(block => {
        const { text, choices, feedback, table, ...fixed } = block
        return { ...fixed, ...(table ? { table: tableStructure(table) } : {}), ...(choices ? { choiceCount: choices.length } : {}) }
      }) })),
    questions: draft.questions.map(q => {
      const question = q as any, { prompt, choices, blanks, items, pairs, guidance, ...fixed } = question
      return { ...fixed, kind: kindOf(q), ...(choices ? { choiceCount: choices.length } : {}),
        ...(blanks ? { blanks: blanks.map((accepted: string[]) => accepted.length) } : {}),
        ...(items ? { itemCount: items.length } : {}), ...(pairs ? { pairCount: pairs.length } : {}) }
    }),
    survey: (draft.survey ?? []).map(({ id, kind }) => ({ id, kind })),
  }
}
export async function validateCourseLocale(env: Bindings, course: string, base: Draft, value: unknown) {
  insist(value && typeof value === 'object' && JSON.stringify(value).length <= 500_000, 'locale_draft_too_large')
  // The ordinary validator retains media admission, inert content and question-shape protections.
  const expected = await normaliseDraft(env, base, course, { admit: false })
  const translated = await normaliseDraft(env, value, course, { admit: false })
  insist(JSON.stringify(structure(expected)) === JSON.stringify(structure(translated)), 'locale_structure_changed', 409)
  return translated
}
