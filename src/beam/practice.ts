// Practice scenarios: a text branching scenario with feedback grounded in an
// approved rubric and the course revision's own sources. The course's named
// reviewer approves deployment. Practice is never scored and never touches
// attempts, completions or certificates; only the learner sees their runs.
import type { Bindings } from '../auth.server'
import type { Kind } from './agent-work'
import type { Actor } from './actor'
import { revisionDetail } from './courses'
import { BeamError, all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'

export interface Choice { label: string; feedback: string; next: string | null; sources: string[] }
export interface Step { id: string; situation: string; choices: Choice[] }

const text = (value: unknown, code: string, max: number) => {
  insist(typeof value === 'string' && value.trim() && value.trim().length <= max, code)
  return (value as string).trim()
}

async function mayDecide(env: Bindings, actor: Actor, payload: { course: string }) {
  const course = await one(env, 'SELECT reviewer_id FROM beam_courses WHERE id = ?', payload.course)
  insist(course && (actor.owner || (actor.roles.has('reviewer') && course.reviewer_id === actor.id)), 'named_reviewer_required', 403)
}

export const scenarioKind: Kind = {
  label: 'Practice scenario',
  prepare: ['author'],
  async validate(env, _actor, value) {
    insist(value && typeof value === 'object' && !Array.isArray(value), 'invalid_payload')
    const payload = value as Record<string, any>
    const course = text(payload.course, 'invalid_course', 64), courseRevision = text(payload.courseRevision, 'invalid_course_revision', 64)
    const current = await one(env, 'SELECT published_revision_id FROM beam_courses WHERE id = ?', course)
    insist(current, 'course_not_found', 404)
    insist(current.published_revision_id === courseRevision, 'revision_not_current', 409)
    // Feedback may cite only sources the published lessons themselves cite.
    const cited = new Set((await revisionDetail(env, courseRevision)).lessons.flatMap(lesson => lesson.sources))
    insist(Array.isArray(payload.steps) && payload.steps.length >= 1 && payload.steps.length <= 12, 'invalid_steps')
    const ids = new Set<string>()
    const steps: Step[] = payload.steps.map((raw: any) => {
      insist(raw && typeof raw === 'object', 'invalid_steps')
      const id = text(raw.id, 'invalid_step_id', 40)
      insist(/^[a-z0-9-]+$/.test(id) && !ids.has(id), 'invalid_step_id')
      ids.add(id)
      insist(Array.isArray(raw.choices) && raw.choices.length >= 2 && raw.choices.length <= 5, 'invalid_choices')
      return { id, situation: text(raw.situation, 'invalid_situation', 2000), choices: raw.choices.map((choice: any) => {
        insist(choice && typeof choice === 'object', 'invalid_choices')
        const sources = choice.sources ?? []
        insist(Array.isArray(sources) && sources.every((source: unknown) => typeof source === 'string' && cited.has(source)), 'source_not_in_revision')
        return { label: text(choice.label, 'invalid_choice_label', 300), feedback: text(choice.feedback, 'invalid_feedback', 1000), next: choice.next === null || choice.next === undefined ? null : text(choice.next, 'invalid_next', 40), sources }
      }) }
    })
    for (const step of steps) for (const choice of step.choices) insist(choice.next === null || (ids.has(choice.next) && choice.next !== step.id), 'invalid_next')
    // Every step is reachable from the first, and the scenario can end.
    const reached = new Set([steps[0].id]), queue = [steps[0]]
    while (queue.length) for (const choice of queue.shift()!.choices) if (choice.next && !reached.has(choice.next)) { reached.add(choice.next); queue.push(steps.find(step => step.id === choice.next)!) }
    insist(reached.size === steps.length, 'unreachable_step')
    insist(steps.some(step => step.choices.some(choice => choice.next === null)), 'scenario_never_ends')
    return { course, courseRevision, title: text(payload.title, 'invalid_title', 160), rubric: text(payload.rubric, 'invalid_rubric', 4000), steps }
  },
  mayDecide,
  async apply(env, actor, { id, payload }) {
    const current = await one(env, 'SELECT published_revision_id FROM beam_courses WHERE id = ?', payload.course)
    insist(current?.published_revision_id === payload.courseRevision, 'proposal_stale', 409)
    const scenario = newId()
    await commit(env, [stmt(env, 'INSERT INTO beam_scenarios (id, course_id, course_revision_id, title, rubric, steps_json, proposal_id, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', scenario, payload.course, payload.courseRevision, payload.title, payload.rubric, JSON.stringify(payload.steps), id, actor.id, now())], { actor, action: 'scenario.deploy', subject: scenario, detail: { proposal: id } })
    return { scenario }
  },
}

/** A scenario its learner may open: one bound to the revision of one of their assignments. */
async function loadScenario(env: Bindings, actor: Actor, id: string): Promise<Row & { steps: Step[] }> {
  const scenario = await one(env, `SELECT s.* FROM beam_scenarios s WHERE s.id = ? AND EXISTS (SELECT 1 FROM beam_assignments a WHERE a.learner_id = ? AND a.course_revision_id = s.course_revision_id)`, id, actor.id)
  if (!scenario) throw new BeamError('not_found', 404)
  return { ...scenario, steps: JSON.parse(scenario.steps_json) as Step[] }
}

/** Scenarios available for practice on an assignment's revision. */
export async function scenariosFor(env: Bindings, revision: string) {
  return await all(env, 'SELECT id, title FROM beam_scenarios WHERE course_revision_id = ? ORDER BY approved_at', revision)
}

export async function practiceView(env: Bindings, actor: Actor, id: string) {
  const scenario = await loadScenario(env, actor, id)
  const run = await one(env, 'SELECT * FROM beam_practice_runs WHERE scenario_id = ? AND learner_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1', id, actor.id)
  const choices: { step: string; choice: number }[] = run ? JSON.parse(run.choices_json) : []
  const last = choices.at(-1)
  const lastChoice = last ? scenario.steps.find(step => step.id === last.step)!.choices[last.choice] : null
  const current = !last ? scenario.steps[0] : lastChoice!.next ? scenario.steps.find(step => step.id === lastChoice!.next)! : null
  const sourceLabels = new Map((await all(env, 'SELECT v.id, s.title, v.number FROM beam_source_versions v JOIN beam_sources s ON s.id = v.source_id')).map(row => [row.id, `${row.title} v${row.number}`]))
  const course = await one(env, 'SELECT a.id FROM beam_assignments a WHERE a.learner_id = ? AND a.course_revision_id = ? ORDER BY a.assigned_at DESC LIMIT 1', actor.id, scenario.course_revision_id)
  return {
    id: scenario.id, title: scenario.title, assignment: course?.id ?? null, courseTitle: (await one(env, 'SELECT title FROM beam_course_revisions WHERE id = ?', scenario.course_revision_id))?.title,
    run: run?.id ?? null, stepNumber: choices.length + (current ? 1 : 0), steps: scenario.steps.length,
    feedback: lastChoice ? { choice: lastChoice.label, text: lastChoice.feedback, sources: lastChoice.sources.map(source => sourceLabels.get(source) ?? source) } : null,
    step: current ? { id: current.id, situation: current.situation, choices: current.choices.map(choice => choice.label) } : null,
    finished: !!last && !current,
  }
}

export async function choosePractice(env: Bindings, actor: Actor, input: Input) {
  const scenario = await loadScenario(env, actor, input.text('scenario'))
  const view = await practiceView(env, actor, scenario.id)
  insist(view.step && view.step.id === input.text('step'), 'practice_step_moved', 409)
  const choice = input.integer('choice', { min: 0, max: view.step.choices.length - 1 })!
  const run = await one(env, 'SELECT * FROM beam_practice_runs WHERE id = ? AND learner_id = ?', view.run ?? '', actor.id)
  const choices = run ? [...JSON.parse(run.choices_json), { step: view.step.id, choice }] : [{ step: view.step.id, choice }]
  // Practice is the learner's own; it is not audited as training evidence.
  if (run) await env.DB.prepare('UPDATE beam_practice_runs SET choices_json = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(choices), now(), run.id).run()
  else await env.DB.prepare('INSERT INTO beam_practice_runs (id, scenario_id, learner_id, choices_json, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(newId(), scenario.id, actor.id, JSON.stringify(choices), now(), now()).run()
  return { id: scenario.id }
}

export async function restartPractice(env: Bindings, actor: Actor, input: Input) {
  const scenario = await loadScenario(env, actor, input.text('scenario'))
  await env.DB.prepare('INSERT INTO beam_practice_runs (id, scenario_id, learner_id, choices_json, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(newId(), scenario.id, actor.id, '[]', now(), now()).run()
  return { id: scenario.id }
}
