// Exact immutable lesson revision determines every required external result. Tool revocation never erases old evidence.
import type { Bindings } from '../auth.server'
import { all, one, type Row } from './core'
import type { Block } from './media'
export async function ltiRequirements(env: Bindings, assignment: Row) {
  const lessons = await all(env, 'SELECT blocks_json FROM beam_lesson_revisions WHERE course_revision_id=?', assignment.course_revision_id)
  const blocks: Block[] = lessons.flatMap(lesson => JSON.parse(lesson.blocks_json)).filter((block: Block) => block.kind === 'lti')
  const reset = await one(env, 'SELECT MAX(reset_at) AS at FROM beam_assignment_resets WHERE assignment_id=?', assignment.id)
  return await Promise.all(blocks.map(async block => {
    const line = await one(env, 'SELECT id FROM beam_lti_lineitems WHERE assignment_id=? AND revision_id=? AND resource_id=? AND learner_id=?', assignment.id, assignment.course_revision_id, block.resource, assignment.learner_id)
    const result = line ? await one(env, 'SELECT * FROM beam_lti_results WHERE lineitem_id=? AND received_at>=? ORDER BY julianday(timestamp) DESC,rowid DESC LIMIT 1', line.id, reset?.at ?? 0) : null
    return { resource: block.resource!, title: block.text, passPercent: block.passPercent!, lineitem: line?.id ?? null, result: result?.id ?? null, passed: Boolean(result && result.activity_progress === 'Completed' && result.grading_progress === 'FullyGraded' && result.score_given * 100 / result.score_maximum >= block.passPercent!) }
  }))
}
