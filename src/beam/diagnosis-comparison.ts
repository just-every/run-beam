// Rule-made evidence comparison. Counts and numeric results are released only for groups of at least three.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt } from './core'
import { diagnosisImport } from './diagnosis-evidence'
import type { Input } from './input'
const round = (n: number) => Math.round(n * 100) / 100
const difference = (a: string[], b: string[]) => a.filter(id => !b.includes(id)).length + b.filter(id => !a.includes(id)).length
export async function compareErrors(env: Bindings, actor: Actor, id: string, url?: URL) {
 insist(!url || ![...url.searchParams.keys()].some(key => /person|employee|member|rank|learner/i.test(key)), 'individual_results_refused')
 const row = await diagnosisImport(env, actor, id)
 const receipt = { id, actor: row.actor, actorName: row.actor_name, importedAt: row.imported_at, filename: row.filename, rows: row.row_count, kept: row.kept, refused: JSON.parse(row.refused_json), withdrawnAt: row.withdrawn_at }
 if (row.withdrawn_at) return { receipt, withdrawn: true as const }
 const cohort: string[] = JSON.parse(row.cohort_json), trained: string[] = JSON.parse(row.trained_json), untrained = cohort.filter(person => !trained.includes(person))
 const observations = await all(env, 'SELECT member, AVG(value) AS mean, MAX(value) AS maximum FROM beam_diagnosis_observations WHERE import_id = ? GROUP BY member', id)
 const earlier = await all(env, 'SELECT cohort_json, trained_json FROM beam_diagnosis_imports WHERE imported_at <= ? AND id <> ?', row.imported_at, id)
 const prior = earlier.flatMap(item => { const c: string[] = JSON.parse(item.cohort_json), t: string[] = JSON.parse(item.trained_json); return [t, c.filter(person => !t.includes(person))] }).filter(group => group.length)
 const groups = [trained, untrained]
 // Also protect a missing-value subgroup or a changed comparison which could isolate one person's value.
 const measured = groups.map(group => group.filter(person => observations.some(o => o.member === person && o.mean !== null)))
 const hidden = groups.some((group, i) => (group.length > 0 && group.length < 3) || (measured[i].length > 0 && measured[i].length < 3) || (group.length > 0 && prior.some(old => { const n = difference(group, old); return n > 0 && n < 3 })))
 const summarize = (group: string[], i: number) => {
  if (hidden) return { hidden: 'privacy_bound', n: null, measured: null, missing: null, mean: null, interval: null }
  const values = observations.filter(o => group.includes(o.member) && o.mean !== null).map(o => Number(o.mean)), n = values.length
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : null
  const variance = n > 1 ? values.reduce((sum, value) => sum + (value - mean!) ** 2, 0) / (n - 1) : 0
  const error = 1.96 * Math.sqrt(variance / (n || 1))
  return { hidden: null, n: group.length, measured: measured[i].length, missing: group.length - n, mean: mean === null ? null : round(mean), interval: mean === null ? null : [round(mean - error), round(mean + error)] }
 }
 const trainedGroup = summarize(trained, 0), untrainedGroup = summarize(untrained, 1)
 const erring = observations.filter(o => Number(o.maximum) > 0).map(o => o.member as string)
 const allTrained = !hidden && erring.length >= 3 && erring.every(person => trained.includes(person))
 const gap = !hidden && !allTrained && trainedGroup.interval && untrainedGroup.interval && untrainedGroup.interval[0] > trainedGroup.interval[1]
 const finding = allTrained ? 'process' : gap ? 'knowledge_gap' : 'uncertain'
 const lessons = await all(env, 'SELECT id, title, body, source_version_ids FROM beam_lesson_revisions WHERE course_revision_id = ? ORDER BY position', row.revision)
 let questions: any = { plan: row.question_plan, hidden: 'no_question_plan', answered: null, totals: [] }
 if (row.question_plan) {
  const p = await one(env, 'SELECT * FROM beam_question_plans WHERE id = ?', row.question_plan)
  const answers = await all(env, 'SELECT answers_json FROM beam_question_answers WHERE plan_id = ?', row.question_plan)
  const released = p && (p.closed_at || p.closes_at <= now()) && answers.length >= 3
  questions = { plan: row.question_plan, hidden: released ? null : 'open_or_below_bound', answered: released ? answers.length : null, totals: released ? JSON.parse(p.questions_json).map((question: string, i: number) => { const n = answers.filter(a => JSON.parse(a.answers_json)[i]).length; return { question, responses: n >= 3 ? n : null } }) : [] }
 }
 const alternatives = [
  { kind: 'training', supported: !!gap, reason: allTrained ? 'The people making errors already completed this revision before the window. Investigate the process.' : gap ? 'The untrained group has higher errors with non-overlapping approximate intervals; a knowledge gap is plausible.' : 'A knowledge gap is not established by the available comparison.' },
  { kind: 'clearer_instructions', supported: true, reason: 'Have the reviewer compare the cited procedure and lesson wording with staff questions; clarity is a human judgment.' },
  { kind: 'process_change', supported: true, reason: allTrained ? 'Errors persist among trained people. Investigate tools, access and the work process.' : 'Check whether tools, access or the work process explain the errors.' },
  { kind: 'no_intervention', supported: true, reason: 'Collect missing evidence or observe before imposing more training.' },
 ]
 return { receipt, withdrawn: false as const, preparedBy: 'rule', finding, trainingRefused: allTrained, basis: { from: row.from_day, to: row.to_day, timezone: row.timezone, course: row.course, revision: row.revision, metric: row.metric, unit: row.unit, completionRule: 'Exact revision completed before window start, unexpired at that instant.' }, groups: { trained: trainedGroup, untrained: untrainedGroup }, procedure: lessons.map(l => ({ id: l.id, title: l.title, body: l.body, sources: JSON.parse(l.source_version_ids) })), questions, alternatives, uncertainty: 'Observed association only, not causation or competence. Approximate 95% intervals use mean ±1.96 standard errors of per-person window means. Missing values and small samples limit inference; procedure clarity and unasked staff concerns need human review.' }
}
export async function prepareDiagnosis(env: Bindings, actor: Actor, input: Input) {
 const id = input.text('import'), row = await diagnosisImport(env, actor, id)
 insist(actor.owner || actor.id === row.actor, 'forbidden', 403)
 const comparison = await compareErrors(env, actor, id)
 insist(!comparison.withdrawn, 'import_withdrawn', 409)
 const diagnosis = newId()
 await commit(env, [stmt(env, 'INSERT INTO beam_diagnoses (id, title, finding, job_role, evidence, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)', diagnosis, `${row.metric}: evidence comparison`, comparison.finding, row.job_role, `Import ${id}; revision ${row.revision}; ${row.from_day}–${row.to_day} (${row.timezone}). Re-read the current comparison before deciding.`, actor.id, now()), stmt(env, 'INSERT INTO beam_diagnosis_basis (diagnosis, import_id) VALUES (?, ?)', diagnosis, id)], { actor, action: 'diagnosis.prepare', subject: diagnosis, detail: { import: id } })
 return { id: diagnosis, comparison }
}
export async function diagnosisTrainingGate(env: Bindings, actor: Actor, diagnosis: string) {
 const basis = await one(env, 'SELECT import_id FROM beam_diagnosis_basis WHERE diagnosis = ?', diagnosis)
 if (!basis) return false
 const comparison = await compareErrors(env, actor, basis.import_id)
 insist(!comparison.withdrawn, 'diagnosis_basis_withdrawn', 409)
 return !comparison.alternatives!.find(option => option.kind === 'training')!.supported
}
