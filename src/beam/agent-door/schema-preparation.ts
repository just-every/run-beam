import type { JsonSchema } from '../../modules/agent-door/index.ts'
import { array, choice, date, id, integer, nullable, object, text, time } from './schema.ts'

const due = { dueDate: date, dueTime: time, timezone: text(64) }
const assignment = object({ learner: id, course: id, courseRevision: id, ...due }, ['learner', 'course', 'courseRevision', 'dueDate', 'timezone'])
const reminders = object({ items: array(object({ assignment: id, message: text(600) }), 200, 1) })
const questions = object({ title: text(160), purpose: text(2000), questions: array(text(500), 10, 1), participants: array(id, 200, 1), closesOn: date })
const recovery = object({ assignment: id, team: id, substitute: id, expiresOn: date })
const process = { oneOf: [object({ summary: text(300), change: text(4000), questionPlan: nullable(id) }, ['summary', 'change']), object({ recovery })] }
const option = object({
  id: { type: 'string', pattern: '^[a-z0-9-]+$', maxLength: 40 },
  kind: choice('clarification', 'practice', 'assessor_session', 'cohort_assignment', 'process_change', 'broad_course'),
  summary: text(600), expectedBenefit: text(600), people: array(id), paidMinutesPerPerson: integer(0, 2400),
  course: id, courseRevision: id, ...due,
}, ['id', 'kind', 'summary', 'expectedBenefit', 'people', 'paidMinutesPerPerson'])
const intervention = object({ diagnosis: id, recommended: text(40), options: array(option, 6, 2) })
const scenario = object({
  course: id, courseRevision: id, title: text(160), rubric: text(4000),
  steps: array(object({
    id: { type: 'string', pattern: '^[a-z0-9-]+$', maxLength: 40 }, situation: text(2000),
    choices: array(object({ label: text(300), feedback: text(1000), next: nullable(text(40)), sources: array(id) }, ['label', 'feedback']), 5, 2),
  }), 12, 1),
})
const common: Record<string, JsonSchema> = {
  title: text(160),
  inputs: array(object({ type: choice('source_version', 'course_revision', 'path_revision', 'assignment', 'question_plan', 'diagnosis'), id }), 30),
  reasons: array(text(300), 20, 1), excluded: array(object({ item: text(200), reason: text(300) }), 50),
}
export const preparationSchema = object({ ...common, kind: choice('assignment_plan', 'reminders', 'question_plan', 'process_change', 'intervention', 'scenario'), payload: { type: 'object' } }, ['kind', 'title', 'reasons', 'payload'])
preparationSchema.oneOf = Object.entries({ assignment_plan: object({ items: array(assignment, 200, 1) }), reminders, question_plan: questions, process_change: process, intervention, scenario })
  .map(([kind, payload]) => ({ properties: { kind: { const: kind }, payload } }))

export const outcomeSchema = object({
  intervention: id, metric: text(160), unit: text(40), direction: choice('lower', 'higher'),
  baselineFrom: date, baselineTo: date, afterFrom: date, afterTo: date,
  comparison: choice('rest_of_role', 'none'), minGroup: integer(3, 50),
})
