import { personIdentitySql } from './erasure-identity'
// Native custody only. Auth/session revocation, import originals and object-store cleanup belong to the caller.
import type { Bindings } from '../auth.server'
import { all, insist, one, stmt } from './core'

type Category = 'practice' | 'assessment' | 'personal' | 'authored'
export interface CustodyRow { table: string; count: number; category: Category; unsupported?: boolean; column?: string }
type Rule = { table: string; where: string; category: Category; keep?: boolean }
const assignments = 'SELECT id FROM beam_assignments WHERE learner_id=?1'
const attempts = `SELECT id FROM beam_attempts WHERE assignment_id IN (${assignments})`
const completions = 'SELECT id FROM beam_completions WHERE learner_id=?1'
const certificates = `SELECT id FROM beam_certificates WHERE completion_id IN (${completions})`
const runs = `SELECT id FROM beam_package_runs WHERE assignment_id IN (${assignments})`
const sessions = `SELECT id FROM beam_package_sessions WHERE actor_id=?1 OR run_id IN (${runs})`
const launches = `SELECT id FROM beam_xapi_launches WHERE actor_id=?1 OR assignment_id IN (${assignments})`
const statements = `SELECT id FROM beam_xapi_statements WHERE launch_id IN (${launches})`
const identities = "SELECT value FROM json_each(?2)"
const nested = (column: string) => `EXISTS(SELECT 1 FROM json_tree(CASE WHEN json_valid(${column}) THEN ${column} ELSE 'null' END) j WHERE j.atom IN (${identities}))`
const history = `json_extract(payload,'$.member')=?1 OR lower(json_extract(payload,'$.email')) IN (SELECT lower(value) FROM json_each(?2))`
const attachmentIds = `SELECT attachment_id FROM beam_attempts WHERE assignment_id IN (${assignments})
 UNION SELECT attachment_id FROM beam_attendance WHERE learner_id=?1
 UNION SELECT attachment_id FROM beam_external_certificates WHERE learner_id=?1
 UNION SELECT json_extract(evidence_json,'$.attachment') FROM beam_completions WHERE learner_id=?1
 UNION SELECT attachment_id FROM beam_discussion_files WHERE post_id IN (SELECT id FROM beam_discussion_posts WHERE author_id=?1)`
const personalAttachments = `uploaded_by=?1 OR id IN (${attachmentIds})`

// Explicit responsibility and order: children precede parents; assessment rows survive only an explicit hold.
const rules: Rule[] = []
const add = (category: Category, entries: Record<string, string>, keep = false) => {
  for (const [table, where] of Object.entries(entries)) rules.push({ table: `beam_${table}`, where, category, keep })
}
add('practice', { sequence_answers: `assignment_id IN (${assignments})`, sequence_state: `assignment_id IN (${assignments})`, practice_runs: 'learner_id=?1' })
add('personal', {
  frontline_credentials: 'member_id=?1',
  webhook_attempts: 'delivery_id IN (SELECT id FROM beam_webhook_deliveries WHERE event_id IN (SELECT id FROM beam_webhook_events WHERE learner_id=?1))',
  webhook_deliveries: 'event_id IN (SELECT id FROM beam_webhook_events WHERE learner_id=?1)', webhook_events: 'learner_id=?1',
  automation_attempts: 'execution_id IN (SELECT id FROM beam_automation_executions WHERE learner_id=?1)', automation_executions: 'learner_id=?1',
  automation_runs: `learner_id=?1 OR source_assignment_id IN (${assignments}) OR target_assignment_id IN (${assignments})`,
  notification_messages: 'learner_id=?1 OR recipient_id=?1', notification_resolutions: `completion_id IN (${completions}) OR ${nested('recipients_json')}`,
  notification_events: `completion_id IN (${completions})`, renewal_notices: 'learner_id=?1 OR recipient_id=?1',
  renewal_cycles: `completion_id IN (${completions}) OR assignment_id IN (${assignments})`, credit_renewal_cycles: 'member_id=?1',
  recovery_delivery: `message IN (SELECT id FROM beam_escalation_messages WHERE recipient_id=?1 OR assignment_id IN (${assignments}))`,
  reminder_messages: `learner_id=?1 OR assignment_id IN (${assignments})`, escalation_messages: `recipient_id=?1 OR assignment_id IN (${assignments})`,
  escalation_resolutions: `assignment_id IN (${assignments})`, upkeep_messages: 'recipient_id=?1',
  announcement_replies: 'learner_id=?1', announcement_recipients: 'learner_id=?1',
  audit: `actor=?1 OR subject IN (${identities}) OR ${nested('detail')} OR ${nested('via')}`,
  view_sessions: 'learner_id=?1 OR viewer_id=?1', audience_members: `member_id=?1 OR assignment_id IN (${assignments})`, audience_exclusions: 'member_id=?1',
  enrollment_requests: `learner_id=?1 OR assignment_id IN (${assignments})`, session_waitlist: `learner_id=?1 OR assignment_id IN (${assignments})`, session_events: 'learner_id=?1',
  roster_batch_rows: `member_id=?1 OR ${nested('cells_json')} OR ${nested('detail_json')}`,
  directory_conflicts: `holder_id=?1 OR other_id=?1 OR ${nested('row_json')}`,
  gusto_language_mappings: 'member_id=?1', inactivity_notices: 'member_id=?1', personalization: 'member_id=?1', recognition_choices: 'member_id=?1',
  favorites: 'member_id=?1', saved_searches: 'member_id=?1', skill_goals: 'member_id=?1', skill_diagnostics: 'member_id=?1', skill_paths: 'member_id=?1',
  diagnosis_observations: 'member=?1', outcome_values: 'member=?1', question_invites: 'member_id=?1', content_feedback: 'learner_id=?1', accommodations: 'learner_id=?1',
  dashboard_shares: 'viewer_id=?1 OR dashboard_id IN (SELECT id FROM beam_dashboards WHERE creator_id=?1)', dashboards: 'creator_id=?1',
  member_roles: 'member_id=?1', team_members: 'member_id=?1', course_authors: 'member_id=?1', admin_grants: 'member_id=?1',
  team_managers: 'member_id=?1', custom_role_grants: 'member_id=?1', auditor_grants: 'member_id=?1',
})
// Instructor grants can be cited by sent announcements: revoke access without deleting that lineage.
add('assessment', {
  xapi_attachments: `statement_id IN (${statements})`, xapi_statements: `launch_id IN (${launches})`, xapi_launches: `id IN (${launches})`,
  cmi5_statements: `session_id IN (${sessions})`, package_events: `session_id IN (${sessions}) OR run_id IN (${runs})`,
}, true)
add('assessment', { cmi5_sessions: `session_id IN (${sessions})`, package_sessions: `id IN (${sessions})` }, true)
add('assessment', {
  cmi5_state: `assignment_id IN (${assignments})`, cmi5_registrations: `assignment_id IN (${assignments})`, package_runs: `id IN (${runs})`,
  lti_results: `lineitem_id IN (SELECT id FROM beam_lti_lineitems WHERE learner_id=?1 OR assignment_id IN (${assignments}))`,
  lti_lineitems: `learner_id=?1 OR assignment_id IN (${assignments})`,
}, true)
add('personal', { xapi_actors: 'learner_id=?1', lti_launches: `member_id=?1 OR assignment_id IN (${assignments})` })
add('personal', { certificate_links: `certificate_id IN (${certificates})` })
add('assessment', {
  certificate_corrections: `certificate_id IN (${certificates})`, certificates: `id IN (${certificates})`,
  quiz_session_answers: `session_id IN (SELECT id FROM beam_quiz_sessions WHERE assignment_id IN (${assignments}))`, quiz_sessions: `assignment_id IN (${assignments})`,
  responses: `attempt_id IN (${attempts})`, review_decisions: `attempt_id IN (${attempts})`, quiz_gradings: `attempt_id IN (${attempts})`,
  completions: 'learner_id=?1', attempts: `assignment_id IN (${assignments})`, attendance: 'learner_id=?1',
  session_registrations: `learner_id=?1 OR assignment_id IN (${assignments})`, external_certificates: 'learner_id=?1', acknowledgments: 'learner_id=?1',
}, true)
add('personal', { lesson_progress: `assignment_id IN (${assignments})`, lesson_progress_history: `assignment_id IN (${assignments})`,
  access_extensions: `assignment_id IN (${assignments})`, due_exceptions: `assignment_id IN (${assignments})`,
  exceptions: `assignment_id IN (${assignments})`, blockers: `learner_id=?1 OR assignment_id IN (${assignments})` })
add('assessment', { assignment_moves: `assignment_id IN (${assignments}) OR from_assignment IN (${assignments})`,
  assignment_resets: `assignment_id IN (${assignments})`, assignments: 'learner_id=?1' }, true)
add('assessment', { history_credit_people: `member_id=?1 OR history_id IN (SELECT id FROM beam_imported_history WHERE ${history})`, imported_history: history }, true)

// These columns record authorship/decisions, not ownership of the affected person's learning.
// Their documents and member IDs survive; callers must disclose that authored material is not fully erased.
const authored: Record<string, string> = {
  source_ocr_config: 'updated_by', source_ocr_runs: 'approved_by',
  access_extensions: 'extended_by', access_rules: 'set_by', accommodations: 'granted_by', acknowledgments: 'requested_by',
  admin_grants: 'granted_by revoked_by', agent_proposals: 'prepared_by decided_by withdrawn_by', announcements: 'sender_id', app_credentials: 'issued_by revoked_by',
  assessment_revisions: 'assessor_id', assignment_moves: 'moved_by', assignment_resets: 'reset_by', assignments: 'assigned_by', attachments: 'uploaded_by',
  attendance: 'recorded_by', audience_exclusions: 'excluded_by lifted_by', audiences: 'created_by enabled_by', auditor_grants: 'granted_by revoked_by',
  automation_executions: 'approved_by', automation_policy: 'updated_by', automation_rules: 'created_by enabled_by', badges: 'created_by', blockers: 'decided_by',
  certificate_corrections: 'issued_by', certificate_links: 'created_by revoked_by', certificate_templates: 'created_by', challenges: 'created_by', cmi5_packages: 'consent_by',
  completions: 'recorded_by', content_feedback: 'closed_by', content_reviews: 'decided_by', course_authors: 'granted_by', course_comments: 'author_id resolved_by',
  course_locales: 'prepared_by submitted_by approved_by', course_revisions: 'submitted_by reviewed_by', courses: 'reviewer_id created_by retired_by owner_id fallback_owner_id',
  custom_role_grants: 'granted_by revoked_by', custom_roles: 'created_by updated_by', dashboard_shares: 'granted_by revoked_by', dashboards: 'revoked_by',
  diagnoses: 'recorded_by reviewed_by', recovery_delivery: 'recorded_by', diagnosis_imports: 'actor reviewer', error_feeds: 'actor', directory_conflicts: 'created_by resolved_by', discussion_files: 'decided_by',
  discussion_posts: 'author_id hidden_by', discussion_threads: 'created_by resolved_by', draft_conflicts: 'author_id resolved_by', due_exceptions: 'approved_by',
  enrollment_requests: 'decided_by', escalation_policy: 'updated_by', escalation_resolutions: 'resolved_by', exception_policy: 'updated_by', exceptions: 'granted_by',
  external_certificates: 'uploaded_by decided_by', external_requirements: 'reviewer_id created_by', group_recognition: 'updated_by', gusto_language_mappings: 'consented_by',
  history_credits: 'approved_by undone_by', inactivity_policy: 'updated_by', instructor_grants: 'granted_by revoked_by', language_defaults: 'updated_by',
  locale_glossaries: 'created_by approved_by', lti_resources: 'selected_by approved_by', lti_tools: 'created_by', notification_rules: 'created_by',
  offline_sessions: 'attested_by', outcome_changes: 'recorded_by', outcome_evaluations: 'closed_by', outcome_plans: 'prepared_by approved_by',
  outcome_retirements: 'decided_by', outcome_values: 'imported_by', packages: 'created_by', path_revisions: 'created_by', proposals: 'prepared_by decided_by',
  question_plans: 'approved_by', quiz_gradings: 'assessor_id', recognition_settings: 'updated_by', reminder_messages: 'approved_by',
  renewal_notices: 'consented_by', renewal_rules: 'created_by enabled_by notice_consent_by', report_settings: 'updated_by', review_decisions: 'assessor_id',
  reviewer_changes: 'previous_reviewer_id reviewer_id changed_by', roster_batches: 'created_by', scenarios: 'approved_by', sessions: 'instructor_id created_by',
  skill_diagnostics: 'recorded_by', skill_paths: 'approved_by', skills: 'created_by reviewed_by', source_notices: 'decided_by', source_versions: 'uploaded_by',
  sources: 'reviewer_id created_by', team_managers: 'granted_by revoked_by', units: 'created_by', webhook_subscriptions: 'created_by',
  xapi_activities: 'created_by', xapi_connections: 'created_by',
}
// Shared machine evidence cannot be silently rewritten: report it for a separately reviewed erasure operation.
const snapshots: Record<string, string> = {
  agent_proposals: 'inputs_json reasons_json excluded_json payload_json result_json', automation_executions: 'input_json', automation_rules: 'preview_json',
  diagnosis_imports: 'refused_json cohort_json trained_json', diagnoses: 'evidence', outcome_plans: 'cohort_json',
  outcome_evaluations: 'evaluation_json retirable_json', outcome_retirements: 'assignments_json',
}

async function context(env: Bindings, memberId: string, aliases: string[] = []) {
  const member = await one(env, `SELECT m.*, o.role AS operator_role FROM beam_members m LEFT JOIN oa_operators o ON o.id=m.operator_id WHERE m.id=?`, memberId)
  insist(member, 'member_not_found', 404)
  const values = [memberId, member.email, member.employee_id, member.username, ...aliases].filter(value => typeof value === 'string' && value.length)
  const lineage = await all<{ id: string }>(env, `SELECT id FROM beam_assignments WHERE learner_id=?1
    UNION SELECT id FROM beam_attempts WHERE assignment_id IN (${assignments})
    UNION SELECT id FROM beam_completions WHERE learner_id=?1 UNION SELECT id FROM beam_certificates WHERE completion_id IN (${completions})
    UNION SELECT id FROM beam_imported_history WHERE json_extract(payload,'$.member')=?1 OR lower(json_extract(payload,'$.email')) IN (SELECT lower(value) FROM json_each(?2))`, memberId, JSON.stringify(values))
  values.push(...lineage.map(row => row.id))
  const columns = await all<{ table_name: string; column_name: string; member_ref: number }>(env, `SELECT m.name AS table_name, p.name AS column_name,
    EXISTS(SELECT 1 FROM pragma_foreign_key_list(m.name) f WHERE f."from"=p.name AND f."table"='beam_members') AS member_ref
    FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type='table' AND m.name GLOB 'beam_*'`)
  const tables = new Set(columns.map(column => column.table_name))
  const prepare = (sql: string) => env.DB.prepare(sql).bind(...(sql.includes('?2') ? [memberId, JSON.stringify(values)] : sql.includes('?1') ? [memberId] : []))
  return { member, columns, tables, prepare }
}

export async function personCustody(env: Bindings, memberId: string, aliases: string[] = []) {
  const ctx = await context(env, memberId, aliases), rows: CustodyRow[] = [], unsupported: string[] = []
  const count = async (table: string, where: string, category: Category, extra: Partial<CustodyRow> = {}) => {
    if (!ctx.tables.has(table)) return
    const result = await ctx.prepare(`SELECT count(*) AS count FROM ${table} WHERE ${where}`).first<{ count: number }>()
    if (result?.count) rows.push({ table, count: result.count, category, ...extra })
  }
  for (const rule of rules) await count(rule.table, rule.where, rule.category)
  await count('beam_members', 'id=?1', 'personal')
  await count('beam_members', 'manager_id=?1', 'personal')
  await count('beam_instructor_grants', 'member_id=?1', 'personal')
  for (const [table, refs] of Object.entries(authored)) await count(`beam_${table}`, refs.split(' ').map(column => `${column}=?1`).join(' OR '), 'authored')
  for (const [table, fields] of Object.entries(snapshots)) for (const column of fields.split(' ')) {
    const before = rows.length
    await count(`beam_${table}`, nested(column), 'personal', { column, unsupported: true })
    if (rows.length > before) unsupported.push(`beam_${table}.${column}`)
  }
  const explicit = new Map<string, Set<string>>()
  for (const rule of rules) explicit.set(rule.table, new Set((rule.where.match(/\b[a-z_]+(?==\?1)/g) ?? [])))
  for (const column of ctx.columns) {
    if (!column.member_ref && !/^(member_id|learner_id|actor_id)$/.test(column.column_name)) continue
    const table = column.table_name, field = column.column_name
    if (table.startsWith('beam_erasure_')) continue // Value-free erasure receipts are the caller's responsibility.
    if (explicit.get(table)?.has(field) || authored[table.slice(5)]?.split(' ').includes(field) || table === 'beam_members' || table === 'beam_instructor_grants') continue
    const before = rows.length
    await count(table, `${field}=?1`, 'personal', { column: field, unsupported: true })
    if (rows.length > before) unsupported.push(`${table}.${field}`)
  }
  const files = await ctx.prepare(`SELECT DISTINCT sha256 FROM beam_attachments WHERE ${personalAttachments}
    UNION SELECT sha256 FROM beam_xapi_attachments WHERE statement_id IN (${statements})`).all<{ sha256: string }>()
  return { rows, fileHashes: files.results.map(file => file.sha256), unsupported,
    authoredMaterial: 'Published/authored documents and their pseudonymous member references remain; this is not full erasure of authored material.' }
}

export async function personEraseStatements(env: Bindings, memberId: string, retainAssessment: boolean, aliases: string[] = []): Promise<D1PreparedStatement[]> {
  const ctx = await context(env, memberId, aliases)
  insist(ctx.member.operator_role !== 'owner' && ctx.member.email?.toLowerCase() !== env.OWNER_EMAIL.toLowerCase(), 'owner_erasure_forbidden', 409)
  const inventory = await personCustody(env, memberId, aliases)
  insist(!inventory.unsupported.length, 'unsupported_person_custody', 409, inventory.unsupported)
  // Capture selectors before deleting evidence; uploads made by a manager still belong to the learner.
  const attachments = await ctx.prepare(`SELECT id FROM beam_attachments WHERE ${personalAttachments}`).all<{ id: string }>()
  const offline = await ctx.prepare("SELECT DISTINCT json_extract(evidence_json,'$.offlineSession') AS id FROM beam_completions WHERE learner_id=?1").all<{ id: string | null }>()
  const held = retainAssessment ? await ctx.prepare(`WITH RECURSIVE held(id) AS (
    SELECT id FROM beam_assignments WHERE learner_id=?1 AND (
      id IN (SELECT assignment_id FROM beam_attempts) OR id IN (SELECT assignment_id FROM beam_completions)
      OR id IN (SELECT assignment_id FROM beam_attendance) OR id IN (SELECT assignment_id FROM beam_package_runs)
      OR id IN (SELECT assignment_id FROM beam_cmi5_state) OR id IN (SELECT assignment_id FROM beam_cmi5_registrations)
      OR id IN (SELECT assignment_id FROM beam_xapi_launches) OR id IN (SELECT assignment_id FROM beam_lti_lineitems))
    UNION SELECT m.from_assignment FROM beam_assignment_moves m JOIN held h ON m.assignment_id=h.id
    UNION SELECT m.assignment_id FROM beam_assignment_moves m JOIN held h ON m.from_assignment=h.id)
    SELECT id FROM held`).all<{ id: string }>() : { results: [] }
  const heldIds = JSON.stringify(held.results.map(row => row.id))
  const holdFilters: Record<string, string> = {
    beam_assignments: 'id NOT IN (SELECT value FROM json_each(?3))',
    beam_assignment_moves: 'assignment_id NOT IN (SELECT value FROM json_each(?3)) AND from_assignment NOT IN (SELECT value FROM json_each(?3))',
    beam_assignment_resets: `id NOT IN (SELECT reset_id FROM beam_attempts WHERE assignment_id IN (${assignments}) AND reset_id IS NOT NULL)`,
    beam_session_registrations: 'id NOT IN (SELECT registration_id FROM beam_attendance)',
    beam_acknowledgments: "state='open'",
    beam_quiz_sessions: 'attempt_id IS NULL',
    beam_quiz_session_answers: 'session_id IN (SELECT id FROM beam_quiz_sessions WHERE attempt_id IS NULL)',
  }
  // Deferred self references (attendance amendments, superseding acknowledgments/certificates) are deleted together.
  const result = [stmt(env, 'PRAGMA defer_foreign_keys=ON')]
  for (const rule of rules) {
    if (!ctx.tables.has(rule.table)) continue
    if (rule.table === 'beam_audit') { result.push(ctx.prepare(`UPDATE beam_audit SET detail='{}',via=NULL WHERE ${rule.where}`)); continue }
    if (retainAssessment && rule.keep) {
      const filter = holdFilters[rule.table]
      if (filter) {
        const sql = `DELETE FROM ${rule.table} WHERE (${rule.where}) AND (${filter})`
        result.push(sql.includes('?3') ? env.DB.prepare(sql).bind(memberId, '[]', heldIds) : ctx.prepare(sql))
      }
    } else result.push(ctx.prepare(`DELETE FROM ${rule.table} WHERE ${rule.where}`))
  }
  if (retainAssessment) result.push(
    ctx.prepare(`UPDATE beam_package_sessions SET auth_session_id='',expires_at=0,ended_at=COALESCE(ended_at,0),initial_json='{}' WHERE id IN (${sessions})`),
    ctx.prepare(`UPDATE beam_cmi5_sessions SET fetch_hash='',auth_hash=NULL,active_registration=NULL,busy=0 WHERE session_id IN (${sessions})`),
    ctx.prepare(`UPDATE beam_xapi_launches SET auth_session_id='',expires_at=0,ended_at=COALESCE(ended_at,0) WHERE id IN (${launches})`),
    ctx.prepare("UPDATE beam_assignments SET reason='',last_lesson_id=NULL,access_rule=NULL WHERE learner_id=?1"),
  )
  if (!retainAssessment) result.push(stmt(env, `DELETE FROM beam_offline_sessions WHERE id IN (SELECT value FROM json_each(?))
    AND id NOT IN (SELECT json_extract(evidence_json,'$.offlineSession') FROM beam_completions WHERE json_extract(evidence_json,'$.offlineSession') IS NOT NULL)`, JSON.stringify(offline.results.map(row => row.id).filter(Boolean))))
  result.push(stmt(env, 'UPDATE beam_instructor_grants SET revoked_at=COALESCE(revoked_at,?) WHERE member_id=?', Date.now(), memberId))
  result.push(stmt(env, 'DELETE FROM beam_instructor_grants WHERE member_id=? AND id NOT IN (SELECT instructor_grant_id FROM beam_announcements WHERE instructor_grant_id IS NOT NULL)', memberId))
  result.push(stmt(env, 'UPDATE beam_members SET manager_id=NULL WHERE manager_id=?', memberId))
  result.push(...personIdentitySql(memberId, Date.now()).map(item => stmt(env,item.sql,...item.params ?? [])))
  // Never remove an attachment still supporting another person's record, authored post, or held evidence.
  result.push(stmt(env, `DELETE FROM beam_attachments WHERE id IN (SELECT value FROM json_each(?))
    AND id NOT IN (SELECT attachment_id FROM beam_attempts WHERE attachment_id IS NOT NULL)
    AND id NOT IN (SELECT attachment_id FROM beam_attendance WHERE attachment_id IS NOT NULL)
    AND id NOT IN (SELECT attachment_id FROM beam_external_certificates)
    AND id NOT IN (SELECT attachment_id FROM beam_offline_sessions WHERE attachment_id IS NOT NULL)
    AND id NOT IN (SELECT attachment_id FROM beam_discussion_files)
    AND id NOT IN (SELECT json_extract(evidence_json,'$.attachment') FROM beam_completions WHERE json_extract(evidence_json,'$.attachment') IS NOT NULL)`, JSON.stringify(attachments.results.map(row => row.id))))
  return result
}
