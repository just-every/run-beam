// AUTO-004: native recurrence only. Imported credit and delivered notices remain explicit gaps.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { insertAssignments } from './assignments'
import { controlledExecution } from './automation-execution'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { business, requireBusiness } from './people'
import { addDays, DAY, localDate, zonedInstant } from './time'

async function ruleFor(env: Bindings, actor: Actor, id: string) {
  requireOwner(actor)
  const rule = await one(env, 'SELECT * FROM beam_renewal_rules WHERE id=?', id)
  insist(rule, 'renewal_rule_not_found', 404)
  return rule
}

export async function saveRenewal(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const course = input.text('course'), basis = input.text('basis')
  insist(['expiry', 'annual'].includes(basis), 'invalid_recurrence')
  insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id=? AND published_revision_id IS NOT NULL AND retired_at IS NULL', course), 'course_not_available', 409)
  const id = newId(), lead = input.integer('leadDays', { max: 365 })!, grace = input.integer('graceDays', { max: 365 })!
  await commit(env, [stmt(env, "INSERT INTO beam_renewal_rules(id,course_id,basis,lead_days,grace_days,state,created_by,created_at) VALUES(?,?,?,?,?,'draft',?,?)", id, course, basis, lead, grace, actor.id, now())],
    { actor, action: 'renewal.save', subject: id, detail: { course, basis, leadDays: lead, graceDays: grace } })
  return { id }
}

/** One latest native completion per person/course. Audit order breaks tied offline dates, as in BEAM-12. */
async function candidates(env: Bindings, rule: Row): Promise<Row[]> {
  const settings = await requireBusiness(env), today = localDate(now(), settings.timezone)
  const records = await all(env, `SELECT c.id AS completion,c.learner_id AS learner,m.name AS learnerName,c.completed_at,c.expires_at,
      a.renewal_days AS renewalDays,a.path_revision_id AS pathRevision,a.prerequisite_course_id AS prerequisite,
      cy.assignment_id AS renewedAssignment,
      (SELECT id FROM beam_assignments open WHERE open.learner_id=c.learner_id AND open.course_id=c.course_id AND open.status='open') AS openAssignment,
      co.retired_at,co.published_revision_id
    FROM beam_completions c JOIN beam_members m ON m.id=c.learner_id JOIN oa_operators o ON o.id=m.operator_id
      JOIN beam_courses co ON co.id=c.course_id LEFT JOIN beam_assignments a ON a.id=c.assignment_id
      LEFT JOIN beam_renewal_cycles cy ON cy.completion_id=c.id
    WHERE c.course_id=? AND o.status='active' AND m.employment<>'terminated' AND c.id=(
      SELECT latest.id FROM beam_completions latest LEFT JOIN beam_audit recorded ON recorded.action='completion.record' AND recorded.subject=latest.id
      WHERE latest.learner_id=c.learner_id AND latest.course_id=c.course_id
      ORDER BY latest.completed_at DESC,recorded.id DESC,latest.id DESC LIMIT 1) ORDER BY m.name,c.id`, rule.course_id)
  return records.flatMap(row => {
    const expiresAt = rule.basis === 'annual' ? row.completed_at + 365 * DAY : row.expires_at
    if (expiresAt === null) return []
    const expiryDate = localDate(expiresAt, settings.timezone), opensOn = addDays(expiryDate, -rule.lead_days)
    const dueDate = addDays(expiryDate, rule.grace_days)
    const outcome = row.renewedAssignment ? 'already_renewed' : row.openAssignment ? 'already_open' : row.retired_at || !row.published_revision_id ? 'course_unavailable' : today < opensOn ? 'not_due' : 'would_assign'
    return [{ ...row, expiresAt, expiryDate, opensOn, dueDate, timezone: settings.timezone, outcome,
      coverage: now() > zonedInstant(dueDate, '17:00', settings.timezone) ? 'overdue' : now() < expiresAt ? 'current' : rule.basis === 'expiry' ? 'expired_in_grace' : 'cycle_due_in_grace' }]
  })
}

export async function previewRenewal(env: Bindings, actor: Actor, input: Input) {
  const rule = await ruleFor(env, actor, input.text('rule')), items = await candidates(env, rule)
  await commit(env, [stmt(env, 'UPDATE beam_renewal_rules SET previewed_at=? WHERE id=?', now(), rule.id)],
    { actor, action: 'renewal.preview', subject: rule.id, detail: { items } })
  return { items }
}

export async function setRenewalState(env: Bindings, actor: Actor, input: Input) {
  const rule = await ruleFor(env, actor, input.text('rule')), state = input.text('state')
  insist(state === 'active' || state === 'paused', 'invalid_state')
  if (state === 'active') insist(rule.previewed_at, 'dry_run_required', 409)
  await commit(env, [
    ...(state === 'active' ? [stmt(env, "UPDATE beam_renewal_rules SET state='paused' WHERE course_id=? AND state='active'", rule.course_id)] : []),
    stmt(env, 'UPDATE beam_renewal_rules SET state=?,enabled_by=?,enabled_at=? WHERE id=?', state, actor.id, now(), rule.id),
  ], { actor, action: `renewal.${state}`, subject: rule.id })
  return { id: rule.id, state }
}

/** Scheduled invocations never retry held/failed events; the owner's explicit run rechecks current inputs and policy. */
export async function runRenewals(env: Bindings, manual = false, only?: string) {
  if (!await business(env)) return []
  const results = []
  for (const rule of await all(env, "SELECT * FROM beam_renewal_rules WHERE state='active' AND (? IS NULL OR id=?) ORDER BY created_at", only ?? null, only ?? null)) {
    for (const item of await candidates(env, rule)) {
      if (item.outcome !== 'would_assign') continue
      const outcome = await controlledExecution(env, { kind: 'renewal', rule: rule.id, event: item.completion, learner: item.learner, authority: rule.enabled_by, unit: null, manual,
        input: { completion: item.completion, course: rule.course_id, basis: rule.basis, expiresAt: item.expiresAt, dueDate: item.dueDate, timezone: item.timezone, leadDays: rule.lead_days, graceDays: rule.grace_days } }, async artifact => {
        insist(await one(env, "SELECT 1 FROM beam_renewal_rules WHERE id=? AND state='active' AND enabled_by=?", rule.id, rule.enabled_by), 'renewal_rule_changed', 409)
        // Recheck the source and open enrollment immediately before the write, including an interrupted replay.
        const current = (await candidates(env, rule)).find(row => row.completion === item.completion)
        const prior = await one(env, 'SELECT id FROM beam_assignments WHERE id=?', artifact)
        insist(current, 'renewal_source_changed', 409)
        if (!prior && current.outcome !== 'would_assign') return current.outcome
        const inserted = prior ? { created: [prior.id] } : await insertAssignments(env, { id: rule.enabled_by } as Actor, [{ id: artifact, learner: item.learner, course: rule.course_id,
          dueDate: item.dueDate, dueTime: '17:00', timezone: item.timezone, reason: 'scheduled renewal', renewalDays: item.renewalDays,
          pathRevision: item.pathRevision, prerequisite: item.prerequisite }], 'assignment.renewal')
        if (!inserted.created.length) return 'already_open'
        await commit(env, [stmt(env, 'INSERT OR IGNORE INTO beam_renewal_cycles VALUES(?,?,?,?,?,?,?)', item.completion, rule.id, artifact, item.expiresAt, item.dueDate, item.timezone, now())],
          { actor: rule.enabled_by, action: 'renewal.assign', subject: artifact, detail: { completion: item.completion, rule: rule.id, expiresAt: item.expiresAt, dueDate: item.dueDate } })
        return 'assigned'
      })
      results.push({ rule: rule.id, completion: item.completion, outcome })
    }
  }
  return results
}

export async function replayRenewal(env: Bindings, actor: Actor, input: Input) {
  const rule = await ruleFor(env, actor, input.text('rule'))
  insist(rule.state === 'active', 'rule_not_active', 409)
  return { results: await runRenewals(env, true, rule.id) }
}

export async function renewalView(env: Bindings, actor: Actor) {
  requireOwner(actor)
  const rules = await all(env, 'SELECT r.*,c.title FROM beam_renewal_rules r JOIN beam_courses c ON c.id=r.course_id ORDER BY r.created_at DESC')
  return { rules: await Promise.all(rules.map(async rule => ({ ...rule, items: await candidates(env, rule) }) as Row)),
    cycles: await all(env, `SELECT cy.*,m.name AS learnerName,c.title FROM beam_renewal_cycles cy JOIN beam_completions done ON done.id=cy.completion_id
      JOIN beam_members m ON m.id=done.learner_id JOIN beam_courses c ON c.id=done.course_id ORDER BY cy.created_at DESC LIMIT 100`) }
}
