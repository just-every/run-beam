import type { Bindings } from '../../auth.server.ts'
import type { ApprovalSummary, NativeTarget } from '../../modules/agent-door/index.ts'
import { isManager, requireRole, type Actor } from '../actor.ts'
import { proposalDetail } from '../agent-work.ts'
import { insist, one } from '../core.ts'
import { requireCourseRole } from '../units.ts'
import type { ToolSpec } from './tool-specs.ts'

export interface NativeRecord { id: string; name: string; revision: number | null; course?: string }

/** Resolve only native records, never an agent-supplied display name/revision. */
export async function nativeRecord(env: Bindings, spec: ToolSpec, args: Record<string, unknown>, actor: Actor): Promise<NativeRecord | null> {
  if (!spec.record) return null
  const id = args[spec.record.argument]
  let row: any
  switch (spec.record.kind) {
    case 'course':
      row = await one(env, 'SELECT id,title AS name,draft_version AS revision,id AS course FROM beam_courses WHERE id=?', id)
      break
    case 'revision':
      row = await one(env, 'SELECT id,title AS name,number AS revision,course_id AS course FROM beam_course_revisions WHERE id=?', id)
      break
    case 'source_version':
      row = await one(env, 'SELECT v.id,s.title AS name,v.number AS revision FROM beam_source_versions v JOIN beam_sources s ON s.id=v.source_id WHERE v.id=? AND s.erased_at IS NULL', id)
      break
    case 'question_plan':
      row = await one(env, 'SELECT id,title AS name,NULL AS revision FROM beam_question_plans WHERE id=?', id)
      if (row) insist(isManager(actor) || await one(env, 'SELECT 1 FROM beam_question_invites WHERE plan_id=? AND member_id=?', id, actor.id), 'not_found', 404)
      break
    case 'notice':
      row = await one(env, 'SELECT n.id,c.title AS name,c.draft_version AS revision,c.id AS course,c.reviewer_id AS reviewer FROM beam_source_notices n JOIN beam_courses c ON c.id=n.course_id WHERE n.id=?', id)
      break
    case 'proposal': {
      const proposal = await proposalDetail(env, actor, String(id))
      row = { id: proposal.id, name: proposal.title, revision: null }
      break
    }
    case 'intervention':
      requireRole(actor, 'manager')
      row = await one(env, "SELECT id,title AS name,NULL AS revision FROM beam_agent_proposals WHERE id=? AND withdrawn_at IS NULL AND kind='intervention'", id)
      break
    case 'diagnosis_import':
      row = await one(env, 'SELECT i.id,i.metric AS name,NULL AS revision,i.actor,i.reviewer,c.reviewer_id AS currentReviewer FROM beam_diagnosis_imports i JOIN beam_courses c ON c.id=i.course WHERE i.id=?', id)
      if (row) insist(actor.owner || row.actor === actor.id && isManager(actor) || row.reviewer === actor.id && row.currentReviewer === actor.id && actor.roles.has('reviewer'), 'forbidden', 403)
      break
  }
  insist(row, `${spec.record.kind}_not_found`, 404)
  if (row.course) {
    const namedReviewer = spec.record.kind === 'notice' && spec.readOnly && actor.roles.has('reviewer') && row.reviewer === actor.id
    if (!namedReviewer) await requireCourseRole(env, actor, row.course, ...(spec.readOnly && spec.record.kind !== 'notice' ? ['author', 'reviewer', 'manager'] as const : ['author'] as const))
  }
  return { id: row.id, name: row.name, revision: row.revision ?? null, ...(row.course ? { course: row.course } : {}) }
}

export async function nativeTargetFor(env: Bindings, spec: ToolSpec, args: Record<string, unknown>, actor: Actor): Promise<NativeTarget | null> {
  const record = await nativeRecord(env, spec, args, actor)
  if (record && spec.record) return { kind: `beam.${spec.record.kind}`, id: record.id }
  // New preparations have no persisted identity yet. Their native records are
  // listed in the summary; native validation still resolves every input.
  return null
}

export async function nativeSummary(env: Bindings, spec: ToolSpec, args: Record<string, unknown>, actor: Actor): Promise<ApprovalSummary> {
  const record = await nativeRecord(env, spec, args, actor)
  const target = record ? { id: record.id, name: record.name } : undefined
  const items = [spec.title]
  if (spec.draft && record) items.push(`Draft version ${record.revision}; human publication required`)
  if (spec.action === 'course.create') {
    const reviewer = await one(env, 'SELECT id,name FROM beam_members WHERE id=?', args.reviewer)
    insist(reviewer, 'reviewer_not_found', 404)
    items.push(`New draft: ${String(args.title)}`, `Human reviewer: ${reviewer.name}`)
  }
  if (args.lesson && record?.course) {
    const lesson = await one(env, "SELECT json_extract(l.value,'$.title') AS title FROM beam_courses c,json_each(c.draft_json,'$.lessons') l WHERE c.id=? AND json_extract(l.value,'$.id')=?", record.course, args.lesson)
    insist(lesson, 'lesson_not_found', 404)
    items.push(`Lesson: ${lesson.title}`)
  }
  if (spec.action === 'proposal.create') {
    const draft = args.draft as { lessons: unknown[]; questions: unknown[] }
    items.push(`${draft.lessons.length} proposed lessons; ${draft.questions.length} proposed questions; a human accepts or declines`)
  }
  if (spec.action === 'agent.propose') {
    const payload = args.payload as Record<string, unknown>
    const count = Array.isArray(payload.items) ? payload.items.length : Array.isArray(payload.options) ? payload.options.length : Array.isArray(payload.steps) ? payload.steps.length : 1
    items.push(`${String(args.kind)}: ${count} prepared items; a human decides and applies`)
  }
  if (spec.action === 'outcome.plan') items.push('Measurement plan only; human approval and evidence import required')
  if (spec.action === 'diagnosis.prepare') items.push('Rule-made diagnosis only; independent human review required')
  return { ...(target ? { target } : {}), items }
}
