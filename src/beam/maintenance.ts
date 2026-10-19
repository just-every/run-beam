// Procedure maintenance without a model account: source-change notices and
// proposed drafts (from a person or the owner's own agent) that carry the input
// versions they were prepared from. A reviewer decides; nothing is applied silently.
import type { Bindings } from '../auth.server'
import { requireRole, type Actor } from './actor'
import { loadCourse, normaliseDraft } from './courses'
import { commit, insist, newId, now, one, stmt } from './core'
import type { Input } from './input'
import { DECISIONS, nextReviewDate } from './upkeep'

export async function proposeDraft(env: Bindings, actor: Actor, input: Input, draftValue: unknown) {
  requireRole(actor, 'author')
  // The passages a proposal relies on must quote one of its named inputs; the
  // reviewer sees them next to what the preparer found missing.
  const inputs = input.list('inputs')
  const passagesValue = input.json('passages') ?? []
  insist(Array.isArray(passagesValue) && passagesValue.length <= 50, 'invalid_passages')
  const passages = passagesValue.map(passage => {
    insist(passage && typeof passage.sourceVersion === 'string' && inputs.includes(passage.sourceVersion), 'passage_not_from_inputs')
    insist(typeof passage.quote === 'string' && passage.quote.trim() && passage.quote.length <= 1000, 'invalid_passages')
    insist(passage.lesson === undefined || (typeof passage.lesson === 'string' && passage.lesson.length <= 160), 'invalid_passages')
    return { sourceVersion: passage.sourceVersion, quote: passage.quote.trim(), lesson: passage.lesson?.trim() || null }
  })
  const missingValue = input.json('missing') ?? []
  insist(Array.isArray(missingValue) && missingValue.length <= 20 && missingValue.every(item => typeof item === 'string' && item.trim() && item.length <= 300), 'invalid_missing')
  return await createProposal(env, actor, {
    course: input.text('course'), draftVersion: input.integer('draftVersion', { min: 1, max: 1_000_000 })!, inputs, draft: draftValue,
    agent: input.text('agent', { max: 120, optional: true }) || null, summary: input.text('summary', { max: 2000 }), passages, missing: (missingValue as string[]).map(item => item.trim()),
  })
}

export interface ProposalFields { course: string; draftVersion: number; inputs: string[]; draft: unknown; agent: string | null; summary: string; passages: { sourceVersion: string; quote: string; lesson: string | null }[]; missing: string[] }

/** Records a proposed draft against the course's current draft version; the caller has checked who may propose. */
export async function createProposal(env: Bindings, actor: Actor, fields: ProposalFields, link: { thread?: string } = {}) {
  const course = await loadCourse(env, fields.course)
  const base = fields.draftVersion
  insist(base === course.draft_version, 'stale_draft', 409, { draftVersion: course.draft_version })
  const inputs = fields.inputs
  for (const version of inputs) insist(await one(env, 'SELECT 1 FROM beam_source_versions WHERE id = ?', version), 'source_version_not_found', 404)
  const draft = await normaliseDraft(env, fields.draft)
  const id = newId()
  const { agent, summary, passages, missing } = fields
  await commit(env, [stmt(env, "INSERT INTO beam_proposals (id, course_id, base_draft_version, input_version_ids, prepared_by, agent, summary, draft_json, state, created_at, passages_json, missing_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)", id, course.id, base, JSON.stringify(inputs), actor.id, agent, summary, JSON.stringify(draft), now(), JSON.stringify(passages), JSON.stringify(missing))], { actor, action: 'proposal.create', subject: id, detail: { course: course.id, base, inputs, agent, viaAgent: actor.agent, ...link } })
  return { id }
}

export async function decideProposal(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'author', 'reviewer')
  const proposal = await one(env, 'SELECT * FROM beam_proposals WHERE id = ?', input.text('proposal'))
  insist(proposal, 'proposal_not_found', 404)
  insist(proposal.state === 'open', 'proposal_decided', 409)
  const decision = input.text('decision')
  if (decision === 'decline') {
    await commit(env, [stmt(env, "UPDATE beam_proposals SET state = 'declined', decided_by = ?, decided_at = ? WHERE id = ? AND state = 'open'", actor.id, now(), proposal.id)], { actor, action: 'proposal.decline', subject: proposal.id })
    return { id: proposal.id, state: 'declined' }
  }
  insist(decision === 'accept', 'invalid_decision')
  const draft = await normaliseDraft(env, JSON.parse(proposal.draft_json))
  // The draft must still be the one the proposal was prepared from.
  const result = await env.DB.batch([
    stmt(env, 'UPDATE beam_courses SET draft_json = ?, title = ?, draft_version = draft_version + 1 WHERE id = ? AND draft_version = ?', JSON.stringify(draft), draft.title, proposal.course_id, proposal.base_draft_version),
    stmt(env, "UPDATE beam_proposals SET state = 'accepted', decided_by = ?, decided_at = ? WHERE id = ? AND state = 'open' AND changes() = 1", actor.id, now(), proposal.id),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', now(), actor.id, 'proposal.accept', proposal.id, JSON.stringify({ course: proposal.course_id })),
  ])
  insist(result[0].meta.changes === 1, 'proposal_stale', 409)
  return { id: proposal.id, state: 'accepted', draftVersion: proposal.base_draft_version + 1 }
}

export async function decideNotice(env: Bindings, actor: Actor, input: Input) {
  const notice = await one(env, 'SELECT n.*, c.reviewer_id FROM beam_source_notices n JOIN beam_courses c ON c.id = n.course_id WHERE n.id = ?', input.text('notice'))
  insist(notice, 'notice_not_found', 404)
  insist(actor.owner || (actor.roles.has('reviewer') && notice.reviewer_id === actor.id), 'named_reviewer_required', 403)
  insist(notice.state === 'open', 'notice_decided', 409)
  const decision = input.text('decision')
  insist((DECISIONS as readonly string[]).includes(decision), 'invalid_decision')
  // AUTHOR-006: the decision also sets the course's next review date.
  const note = input.text('note', { max: 2000 }), nextReviewOn = await nextReviewDate(env, input)
  await commit(env, [
    stmt(env, "UPDATE beam_source_notices SET state = ?, note = ?, next_review_on = ?, decided_by = ?, decided_at = ? WHERE id = ? AND state = 'open'", decision, note, nextReviewOn, actor.id, now(), notice.id),
    stmt(env, 'UPDATE beam_courses SET next_review_on = ? WHERE id = ?', nextReviewOn, notice.course_id),
  ], { actor, action: `notice.${decision}`, subject: notice.id, detail: { note, nextReviewOn } })
  return { id: notice.id, state: decision, nextReviewOn }
}
