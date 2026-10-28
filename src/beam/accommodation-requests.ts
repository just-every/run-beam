// A learner asks for numeric extra time without collecting a medical diagnosis.
// Conservative privacy default: only that learner and the human owner read requests.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { requireOwner } from './actor'
import { all, insist, newId, now, one, stmt } from './core'
import type { Input } from './input'
import { loadAssignment } from './learning'
import { requireAccess } from './access'

const human = (actor: Actor) => insist(!actor.agent && !actor.viewAs, 'human_session_required', 403)
export async function accommodationRequests(env: Bindings, actor: Actor) {
  human(actor)
  return all(env, `SELECT r.id, r.assignment_id AS assignment, r.learner_id AS learner, m.name AS learnerName,
    c.title AS courseTitle, r.kind, r.amount, r.state, r.requested_at AS requestedAt, r.decided_at AS decidedAt
    FROM beam_accommodation_requests r JOIN beam_members m ON m.id=r.learner_id JOIN beam_courses c ON c.id=r.course_id
    WHERE (?=1 OR r.learner_id=?) ORDER BY r.requested_at DESC, r.rowid DESC`, actor.owner ? 1 : 0, actor.id)
}
export async function requestAccommodation(env: Bindings, actor: Actor, input: Input) {
  human(actor)
  const assignment = await loadAssignment(env, actor, input.text('assignment'))
  insist(assignment.learner_id === actor.id, 'own_learning_only', 403)
  insist(assignment.status === 'open', 'assignment_not_open', 409)
  requireAccess(assignment)
  const kind = input.text('kind')
  insist(kind === 'minutes' || kind === 'percent', 'invalid_kind')
  const amount = input.integer('amount', { min: 1, max: kind === 'minutes' ? 600 : 400 })!
  const id = newId(), at = now()
  const inserted = await env.DB.batch([
    stmt(env, `INSERT INTO beam_accommodation_requests(id,learner_id,assignment_id,course_id,kind,amount,state,requested_at)
      SELECT ?,?,?,?,?,?,'pending',? WHERE NOT EXISTS(SELECT 1 FROM beam_accommodation_requests WHERE learner_id=? AND course_id=? AND state='pending')`,
      id, actor.id, assignment.id, assignment.course_id, kind, amount, at, actor.id, assignment.course_id),
    stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,'accommodation.request',?,'{}' WHERE EXISTS(SELECT 1 FROM beam_accommodation_requests WHERE id=?)`, at, actor.id, id, id),
  ])
  insist(inserted[0].meta.changes === 1, 'accommodation_request_pending', 409)
  return { id }
}
export async function decideAccommodation(env: Bindings, actor: Actor, input: Input) {
  human(actor); requireOwner(actor)
  const id = input.text('request'), decision = input.text('decision')
  insist(decision === 'approve' || decision === 'decline', 'invalid_decision')
  const row = await one(env, 'SELECT * FROM beam_accommodation_requests WHERE id=?', id)
  insist(row, 'accommodation_request_not_found', 404)
  insist(row.state === 'pending', 'accommodation_request_decided', 409)
  const token = newId(), grant = decision === 'approve' ? newId() : null, at = now()
  // Claim the request and create the grant in one transaction. Only the winning
  // decision may insert it. Erasure and assignment state are rechecked in SQL.
  const result = await env.DB.batch([
    stmt(env, `UPDATE beam_accommodation_requests SET state=?,decided_by=?,decided_at=?,grant_id=?,decision_id=? WHERE id=? AND state='pending'
      AND EXISTS(SELECT 1 FROM beam_members WHERE id=learner_id AND erased_at IS NULL AND erasure_pending=0)
      AND EXISTS(SELECT 1 FROM beam_assignments WHERE id=assignment_id AND status='open')`, decision === 'approve' ? 'approved' : 'declined', actor.id, at, grant, token, id),
    ...(grant ? [stmt(env, `INSERT INTO beam_accommodations(id,learner_id,course_id,kind,amount,note,granted_by,granted_at)
      SELECT ?,learner_id,course_id,kind,amount,'Learner request approved by the owner',?,? FROM beam_accommodation_requests WHERE id=? AND grant_id=? AND state='approved'`, grant, actor.id, at, id, grant)] : []),
    stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,'accommodation.decide',?,'{}' FROM beam_accommodation_requests WHERE id=? AND decision_id=?` , at, actor.id, id, id, token),
  ])
  insist(result[0].meta.changes === 1, 'accommodation_request_changed', 409)
  return { id, grant }
}
