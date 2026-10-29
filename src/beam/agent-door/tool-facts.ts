import type { Bindings } from '../../auth.server.ts'
import type { ClassAndFacts } from '../../modules/agent-door/index.ts'
import { requireRole, type Actor } from '../actor.ts'
import { one } from '../core.ts'
import { learnerScope, requireTeamScope } from '../scope.ts'
import type { ToolSpec } from './tool-specs.ts'

/** Policy measures come from the current native scope and existing records.
 * Draft/preparation writes save one internal record; they do not execute the
 * proposed assignments, messages, provider work or other human decisions. */
export async function nativeFacts(env: Bindings, spec: ToolSpec, args: Record<string, unknown>, actor: Actor): Promise<ClassAndFacts[]> {
  if (!spec.readOnly) return [{ class: 'standard', facts: { measure: 1 } }]
  if (!spec.privacy) return [{ class: 'standard', facts: { measure: 1 } }]
  let records = 0
  if (spec.privacy === 'identity') records = 1
  if (spec.privacy === 'people') {
    const scope = learnerScope(actor, 'people')
    records = (await one<{ count: number }>(env, 'SELECT COUNT(*) AS count FROM beam_members WHERE (? IS NULL OR id IN (SELECT value FROM json_each(?)))', scope, scope))!.count
  }
  if (spec.privacy === 'report') {
    const scope = learnerScope(actor, 'reports')
    if (args.team) requireTeamScope(actor, String(args.team), 'reports')
    // Count matching native rows before the status presentation filter. This
    // avoids expiring attempts or revealing records during policy evaluation.
    const course = args.course ?? '', team = args.team ?? ''
    const rows = await one<{ count: number }>(env, `SELECT COUNT(*) AS count FROM (
      SELECT a.learner_id AS learner,a.course_id AS course FROM beam_assignments a WHERE a.status!='replaced'
      UNION ALL SELECT c.learner_id,c.course_id FROM beam_completions c WHERE c.assignment_id IS NULL)
      WHERE (? IS NULL OR learner IN (SELECT value FROM json_each(?))) AND (?='' OR course=?)
      AND (?='' OR learner IN (SELECT member_id FROM beam_team_members WHERE team_id=?))`, scope, scope, course, course, team, team)
    // External requirements can add a missing/pending/certified report row for
    // each scoped person; bound these using current native records as well.
    const external = await one<{ count: number }>(env, `SELECT COUNT(*) AS count FROM beam_external_requirements r CROSS JOIN beam_members m
      WHERE (? IS NULL OR m.id IN (SELECT value FROM json_each(?))) AND (?='' OR m.id IN (SELECT member_id FROM beam_team_members WHERE team_id=?))`, scope, scope, team, team)
    records = rows!.count + external!.count
  }
  if (spec.privacy === 'proposals') {
    requireRole(actor, 'author', 'reviewer', 'manager')
    records = (await one<{ count: number }>(env, 'SELECT COUNT(*) AS count FROM beam_agent_proposals WHERE prepared_by=? AND state=? AND withdrawn_at IS NULL', actor.id, args.state ?? 'waiting'))!.count
  }
  if (spec.privacy === 'proposal') records = (await one<{ count: number }>(env, 'SELECT COUNT(*) AS count FROM beam_agent_proposals WHERE id=? AND withdrawn_at IS NULL', args.id))!.count
  return [{ class: 'sensitive', facts: { measure: records, kind: spec.privacy === 'report' ? 'personal_training_records' : spec.privacy === 'people' ? 'employee_directory' : spec.privacy === 'identity' ? 'sponsor_identity' : 'personal_preparations' } }]
}
