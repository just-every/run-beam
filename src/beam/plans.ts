// Manager-approved preparation kinds: targeted assignment plans, reminder
// drafts and recorded process-change recommendations. A plan names the exact
// published revision it assigns; approving it after a newer publication is
// refused, so nobody is assigned something they did not review.
import type { Bindings } from '../auth.server'
import type { Kind } from './agent-work'
import { isManager, type Actor } from './actor'
import { insertAssignments } from './assignments'
import { all, commit, insist, newId, now, one, stmt } from './core'
import { validTimezone, zonedInstant } from './time'
import { requireLearnerScope } from './scope'

const object = (value: unknown, code: string): Record<string, any> => {
  insist(value && typeof value === 'object' && !Array.isArray(value), code)
  return value as Record<string, any>
}
const text = (value: unknown, code: string, max: number) => {
  insist(typeof value === 'string' && value.trim() && value.trim().length <= max, code)
  return (value as string).trim()
}
const managerOnly = async (_env: Bindings, actor: Actor) => { insist(isManager(actor), 'forbidden', 403) }

interface PlanItem { learner: string; course: string; courseRevision: string; dueDate: string; dueTime: string; timezone: string }

export const assignmentPlan: Kind = {
  label: 'Assignment plan',
  prepare: ['manager'],
  async validate(env, _actor, value) {
    const payload = object(value, 'invalid_payload')
    insist(Array.isArray(payload.items) && payload.items.length >= 1 && payload.items.length <= 200, 'invalid_items')
    const seen = new Set<string>(), items: PlanItem[] = []
    for (const raw of payload.items) {
      const item = object(raw, 'invalid_items')
      const plan = { learner: text(item.learner, 'invalid_learner', 64), course: text(item.course, 'invalid_course', 64), courseRevision: text(item.courseRevision, 'invalid_course_revision', 64), dueDate: text(item.dueDate, 'invalid_due_date', 10), dueTime: text(item.dueTime ?? '17:00', 'invalid_due_time', 5), timezone: text(item.timezone, 'invalid_timezone', 64) }
      insist(validTimezone(plan.timezone), 'invalid_timezone')
      zonedInstant(plan.dueDate, plan.dueTime, plan.timezone)
      insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', plan.learner), 'person_not_found', 404)
      const course = await one(env, 'SELECT published_revision_id FROM beam_courses WHERE id = ?', plan.course)
      insist(course, 'course_not_found', 404)
      insist(course.published_revision_id === plan.courseRevision, 'revision_not_current', 409)
      insist(!seen.has(`${plan.learner}:${plan.course}`), 'duplicate_item')
      seen.add(`${plan.learner}:${plan.course}`)
      items.push(plan)
    }
    return { items }
  },
  mayDecide: managerOnly,
  async apply(env, actor, { id, payload }) {
    for (const item of payload.items as PlanItem[]) {
      requireLearnerScope(actor, item.learner)
      const course = await one(env, 'SELECT published_revision_id FROM beam_courses WHERE id = ?', item.course)
      insist(course?.published_revision_id === item.courseRevision, 'proposal_stale', 409, { course: item.course })
    }
    return await insertAssignments(env, actor, (payload.items as PlanItem[]).map(item => ({ ...item, reason: `plan ${id}` })), 'assignment.plan')
  },
}

export const reminderDrafts: Kind = {
  label: 'Reminder draft',
  prepare: ['manager'],
  async validate(env, _actor, value) {
    const payload = object(value, 'invalid_payload')
    insist(Array.isArray(payload.items) && payload.items.length >= 1 && payload.items.length <= 200, 'invalid_items')
    const items = []
    for (const raw of payload.items) {
      const item = object(raw, 'invalid_items')
      const assignment = text(item.assignment, 'invalid_assignment', 64)
      insist(await one(env, "SELECT 1 FROM beam_assignments WHERE id = ? AND status = 'open'", assignment), 'assignment_not_open', 409)
      items.push({ assignment, message: text(item.message, 'invalid_message', 600) })
    }
    return { items }
  },
  mayDecide: managerOnly,
  async apply(env, actor, { id, payload }) {
    const delivered: string[] = [], skipped: string[] = []
    const statements = []
    for (const item of payload.items as { assignment: string; message: string }[]) {
      // An assignment that closed since preparation gets no message.
      const open = await one(env, "SELECT learner_id FROM beam_assignments WHERE id = ? AND status = 'open'", item.assignment)
      if (!open) { skipped.push(item.assignment); continue }
      requireLearnerScope(actor, open.learner_id)
      statements.push(stmt(env, 'INSERT INTO beam_reminder_messages (id, assignment_id, learner_id, body, proposal_id, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), item.assignment, open.learner_id, item.message, id, actor.id, now()))
      delivered.push(item.assignment)
    }
    if (statements.length) await commit(env, statements, { actor: actor.id, action: 'reminder.deliver', subject: id, detail: { delivered } })
    return { delivered, skipped }
  },
}

export const processChange: Kind = {
  label: 'Process change',
  prepare: ['manager'],
  async validate(env, _actor, value) {
    const payload = object(value, 'invalid_payload')
    const plan = payload.questionPlan === undefined || payload.questionPlan === null ? null : text(payload.questionPlan, 'invalid_question_plan', 64)
    if (plan) insist(await one(env, 'SELECT 1 FROM beam_question_plans WHERE id = ?', plan), 'question_plan_not_found', 404)
    return { summary: text(payload.summary, 'invalid_summary', 300), change: text(payload.change, 'invalid_change', 4000), questionPlan: plan }
  },
  mayDecide: managerOnly,
  // Approval records the decision; changing the procedure itself stays a person's work.
  async apply() { return { recorded: true } },
}

/** Approved reminder messages for the learner's open assignments. */
export async function reminderMessages(env: Bindings, actor: Actor) {
  return await all(env, `SELECT r.id, r.assignment_id AS assignment, c.title AS courseTitle, r.body, m.name AS approvedBy, r.created_at AS createdAt
    FROM beam_reminder_messages r JOIN beam_assignments a ON a.id = r.assignment_id JOIN beam_courses c ON c.id = a.course_id JOIN beam_members m ON m.id = r.approved_by
    WHERE r.learner_id = ? AND a.status = 'open' ORDER BY r.created_at DESC`, actor.id)
}
