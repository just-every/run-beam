import { portalCompletion } from './portal-completion'
import { portalAssessment } from './portal-assessment'
// ORG-008 preparation boundary. These rows never confer employee authority or completion.
import { portalLearning } from './portal-learning'
import { operatorAuth, type Bindings } from '../auth.server'
import { currentActor, requireOwner, type Actor } from './actor'
import { all, BeamError, commit, insist, newId, now, one, stmt } from './core'
import { Input } from './input'
import { portalTheme, readThemeInput } from './portal-theme'
import { normalizeEmail } from '../modules/operator-auth/index.mjs'
import { refuseErasedIdentity } from './erasure-fence'

const humanOwner = (actor: Actor) => { requireOwner(actor); insist(!actor.agent && !actor.app && !actor.viewAs, 'human_owner_required', 403) }
async function portal(env: Bindings, id: string) {
  const row = await one(env, 'SELECT * FROM beam_enterprise_portals WHERE id=?', id)
  insist(row, 'portal_not_found', 404)
  return row
}
export async function createPortal(env: Bindings, actor: Actor, input: Input) {
  humanOwner(actor)
  const kind = input.text('kind'), name = input.text('name', { max: 120 }), consent = input.text('consentText', { max: 2000 })
  insist(['employee', 'customer', 'partner'].includes(kind), 'invalid_portal_kind')
  insist(input.flag('confirm'), 'portal_confirmation_required')
  insist(kind !== 'employee' || !await one(env, "SELECT 1 FROM beam_enterprise_portals WHERE kind='employee'"), 'employee_portal_exists', 409)
  // Snapshot the already validated ORG-009 theme; later employee-theme edits cannot alter this portal.
  const theme = await portalTheme(env)
  insist(theme, 'configure_employee_theme_first', 409)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_enterprise_portals (id,kind,name,consent_text,theme_json,created_by,created_at) VALUES(?,?,?,?,?,?,?)', id, kind, name, consent, JSON.stringify(theme), actor.id, now())], { actor, action: 'portal.create', subject: id, detail: { kind } })
  return { id, kind, name, state: 'preparation' }
}
export async function sharePortalRevision(env: Bindings, actor: Actor, input: Input) {
  humanOwner(actor)
  const id = input.text('portal'), revision = input.text('revision')
  await portal(env, id)
  insist(input.flag('confirm'), 'portal_share_confirmation_required')
  insist(await one(env, "SELECT 1 FROM beam_course_revisions r JOIN beam_courses c ON c.id=r.course_id WHERE r.id=? AND r.state IN ('published','superseded') AND c.retired_at IS NULL AND c.archived_at IS NULL", revision), 'published_revision_required', 409)
  const revoked = input.flag('revoke')
  await commit(env, [stmt(env, `INSERT INTO beam_portal_shares VALUES(?,?,?,?,?) ON CONFLICT(portal_id,revision_id) DO UPDATE SET shared_by=excluded.shared_by,shared_at=excluded.shared_at,revoked_at=excluded.revoked_at`, id, revision, actor.id, now(), revoked ? now() : null)], { actor, action: revoked ? 'portal.unshare' : 'portal.share', subject: id, detail: { revision } })
  return { portal: id, revision, revoked }
}
export async function invitePortalIdentity(env: Bindings, actor: Actor, input: Input, request: Request) {
  humanOwner(actor)
  const id = input.text('portal'), p = await portal(env, id)
  insist(p.kind !== 'employee', 'external_portal_required')
  insist(input.flag('sendInvitation'), 'explicit_invitation_consent_required')
  const email = normalizeEmail(input.text('email', { max: 254 })), name = input.text('name', { max: 120 })
  insist(email, 'invalid_email')
  await refuseErasedIdentity(env, [email])
  // Base verifies the account. No member, role, team, email-derived identity or employee enrollment is created.
  const previous = await one(env, 'SELECT id,status FROM oa_operators WHERE lower(email)=?', email)
  insist(!previous || previous.status === 'active', 'portal_account_unavailable', 409)
  const employee = await one(env, 'SELECT id FROM beam_members WHERE lower(email)=? OR operator_id=?', email, previous?.id ?? '')
  if (employee) {
    await commit(env, [], { actor, action: 'portal.identity.collision', subject: id, detail: { employee: employee.id, outcome: 'refused', reason: 'reviewed_link_required' } })
    insist(false, 'employee_identity_link_required', 409)
  }
  const identity = newId()
  if (!previous) await operatorAuth(env).invite(request, { email, displayName: name, role: 'member', returnTo: `/portal/${id}/claim?identity=${identity}` })
  const account = previous ?? await one(env, 'SELECT id FROM oa_operators WHERE lower(email)=?', email)
  insist(account, 'portal_account_unavailable', 409)
  const existing = await one(env, 'SELECT id FROM beam_portal_identities WHERE portal_id=? AND (operator_id=? OR invited_operator_id=?)', id, account.id, account.id)
  insist(!existing, 'portal_identity_exists', 409)
  await commit(env, [stmt(env, 'INSERT INTO beam_portal_identities(id,portal_id,operator_id,display_name,invited_by,invited_at,invited_operator_id) VALUES(?,?,NULL,?,?,?,?)', identity, id, name, actor.id, now(), account.id)], { actor, action: 'portal.invite', subject: id, detail: { identity } })
  return { id: identity, portal: id, state: 'claim_required' }
}
export async function grantPortalAdministrator(env: Bindings, actor: Actor, input: Input) {
  humanOwner(actor)
  const id = input.text('portal'), identity = input.text('identity'), revoke = input.flag('revoke')
  await portal(env, id)
  insist(await one(env, 'SELECT 1 FROM beam_portal_identities WHERE portal_id=? AND id=? AND operator_id IS NOT NULL AND consent_at IS NOT NULL AND revoked_at IS NULL', id, identity), 'portal_identity_not_found', 404)
  const at = now()
  const result = await env.DB.batch([
    stmt(env, `INSERT INTO beam_portal_administrators
      SELECT i.portal_id,i.id,?,?,? FROM beam_portal_identities i JOIN beam_enterprise_portals p ON p.id=i.portal_id
      WHERE i.portal_id=? AND i.id=? AND i.operator_id IS NOT NULL AND i.consent_at IS NOT NULL
      AND i.revoked_at IS NULL AND i.consent_version=p.notice_version
      ON CONFLICT(portal_id,identity_id) DO UPDATE SET granted_by=excluded.granted_by,granted_at=excluded.granted_at,revoked_at=excluded.revoked_at`, actor.id, at, revoke ? at : null, id, identity),
    stmt(env, 'INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,?,?,? WHERE changes()=1', at, actor.id, revoke ? 'portal.admin.revoke' : 'portal.admin.grant', id, JSON.stringify({ identity })),
  ])
  insist(result[0].meta.changes === 1, 'portal_identity_not_found', 404)
  return { portal: id, identity, revoked: revoke }
}
export async function revokePortalIdentity(env: Bindings, actor: Actor, input: Input) {
  humanOwner(actor)
  const id = input.text('portal'), identity = input.text('identity')
  insist(await one(env, 'SELECT 1 FROM beam_portal_identities WHERE portal_id=? AND id=?', id, identity), 'portal_identity_not_found', 404)
  await commit(env, [stmt(env, 'UPDATE beam_portal_identities SET revoked_at=?,consent_at=NULL WHERE portal_id=? AND id=?', now(), id, identity), stmt(env, 'UPDATE beam_portal_administrators SET revoked_at=COALESCE(revoked_at,?) WHERE portal_id=? AND identity_id=?', now(), id, identity)], { actor, action: 'portal.identity.revoke', subject: id, detail: { identity } })
  return { portal: id, identity, revoked: true }
}

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } })
/** Handle this entire namespace before employee actor resolution. Unknown doors fail closed. */
export async function enterprisePortalResponse(env: Bindings, request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (path !== '/api/beam/portal' && !path.startsWith('/api/beam/portal/')) return null
  try {
    insist(!request.headers.has('authorization'), 'human_session_required', 403)
    // A View as cookie must never turn the underlying owner's session into portal authority.
    insist(!/(?:^|;\s*)beam_view=/.test(request.headers.get('cookie') ?? ''), 'view_as_read_only', 403)
    insist(['GET', 'HEAD', 'POST'].includes(request.method), 'method_not_allowed', 405)
    if (request.method === 'POST') insist(request.headers.get('origin') === env.AUTH_ORIGIN, 'invalid_origin', 403)
    const session = await operatorAuth(env).getSession(request)
    insist(session, 'authentication_required', 401)
    insist(session.kind !== 'dev' && session.kind !== 'review', 'verified_human_session_required', 403)
    const owner = session.operator.role === 'owner'
    const match = path.match(/^\/api\/beam\/portal\/([\w-]+)\/(claim|consent|catalog|roster|enroll|report|learning|progress\.json|assessment|assessment\.json|completion|certificate\.pdf)$/)
    insist(match, 'portal_door_not_found', 404)
    const [, id, door] = match, p = await portal(env, id)
    // Consent remains reachable after owner revocation; ordinary doors remain closed.
    const identity = await one(env, 'SELECT * FROM beam_portal_identities WHERE portal_id=? AND operator_id=?', id, session.operator.id)
    if (door === 'claim') {
      const intended = request.method === 'POST' ? (await Input.from(request)).text('identity') : new URL(request.url).searchParams.get('identity')
      insist(intended, 'missing_identity')
      const pending = await one(env, 'SELECT * FROM beam_portal_identities WHERE portal_id=? AND id=? AND invited_operator_id=? AND revoked_at IS NULL', id, intended, session.operator.id)
      insist(pending, 'portal_invitation_not_found', 404)
      const employee = await one(env, 'SELECT id FROM beam_members WHERE operator_id=? OR lower(email)=?', session.operator.id, session.operator.email.toLowerCase())
      if (employee) {
        await commit(env, [], { actor: session.operator.id, action: 'portal.identity.collision', subject: id, detail: { identity: intended, employee: employee.id, outcome: 'refused', reason: 'reviewed_link_required' } })
        insist(false, 'employee_identity_link_required', 409)
      }
      if (request.method !== 'POST') return json({ portal: id, identity: intended, name: p.name, state: pending.operator_id ? 'consent_required' : 'claim_required' })
      insist(!pending.operator_id || pending.operator_id === session.operator.id, 'portal_account_binding_conflict', 409)
      const boundAt = now()
      const result = await env.DB.batch([stmt(env, `UPDATE beam_portal_identities SET operator_id=?,bound_at=COALESCE(bound_at,?)
        WHERE portal_id=? AND id=? AND invited_operator_id=? AND revoked_at IS NULL AND (operator_id IS NULL OR operator_id=?)
        AND NOT EXISTS(SELECT 1 FROM beam_members WHERE operator_id=? OR lower(email)=?)`, session.operator.id, boundAt, id, intended, session.operator.id, session.operator.id, session.operator.id, session.operator.email.toLowerCase()),
        stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,'portal.identity.bind',?,? WHERE changes()=1`, boundAt, session.operator.id, id, JSON.stringify({ identity: intended, account: session.operator.id, outcome: 'bound' })),
      ])
      insist(result[0].meta.changes === 1, 'portal_account_binding_conflict', 409)
      return json({ portal: id, identity: intended, state: 'consent_required' })
    }
    insist(owner || identity, 'portal_not_found', 404)
    if (door === 'consent') {
      insist(identity, 'portal_identity_not_found', 404)
      const notice = await one(env, 'SELECT disclosure_json FROM beam_portal_notices WHERE portal_id=? AND version=?', id, p.notice_version)
      if (request.method === 'POST') {
        const input = await Input.from(request)
        if (input.flag('withdraw')) {
          await commit(env, [stmt(env, 'UPDATE beam_portal_identities SET consent_at=NULL WHERE id=?', identity.id),
            stmt(env, 'UPDATE beam_portal_administrators SET revoked_at=COALESCE(revoked_at,?) WHERE portal_id=? AND identity_id=?', now(), id, identity.id),
            stmt(env, "INSERT INTO beam_portal_consent_events VALUES(?,?,?,?,?,'withdraw',?)", newId(), id, identity.id, session.operator.id, identity.consent_version ?? 0, now())],
            { actor: session.operator.id, action: 'portal.consent.withdraw', subject: id, detail: { identity: identity.id, noticeVersion: identity.consent_version ?? 0, outcome: 'withdrawn' } })
          return json({ portal: id, accepted: false })
        }
        insist(!identity.revoked_at, 'portal_identity_not_found', 404)
        insist(input.flag('accept'), 'explicit_portal_consent_required')
        insist(notice && p.notice_version > 0, 'portal_notice_required', 409)
        const version = input.integer('noticeVersion', { min: 1 })
        insist(version === p.notice_version, 'portal_notice_changed', 409)
        const at = now(), event = newId()
        await commit(env, [stmt(env, `UPDATE beam_portal_identities SET consent_at=?,consent_version=? WHERE id=? AND operator_id=? AND revoked_at IS NULL
          AND EXISTS(SELECT 1 FROM beam_enterprise_portals WHERE id=? AND notice_version=?)`, at, version, identity.id, session.operator.id, id, version),
          stmt(env, `INSERT INTO beam_portal_consent_events SELECT ?,portal_id,id,operator_id,consent_version,'accept',? FROM beam_portal_identities
            WHERE id=? AND consent_at=? AND consent_version=? AND revoked_at IS NULL`, event, at, identity.id, at, version)],
          { actor: session.operator.id, action: 'portal.consent', subject: id, detail: { identity: identity.id, noticeVersion: version, outcome: 'accepted' } })
        insist(await one(env, 'SELECT 1 FROM beam_portal_consent_events WHERE id=?', event), 'portal_notice_changed', 409)
      }
      const decision = await one(env, 'SELECT identity_id AS identity,operator_id AS account,notice_version AS noticeVersion,action,at FROM beam_portal_consent_events WHERE portal_id=? AND identity_id=? ORDER BY at DESC,rowid DESC LIMIT 1', id, identity.id)
      return json({ portal: id, name: p.name, consentText: p.consent_text, noticeVersion: p.notice_version, decision,
        notice: notice ? JSON.parse(notice.disclosure_json) : null, accepted: request.method === 'POST' || !!identity.consent_at,
        accessClosed: !!identity.revoked_at })
    }
    insist(owner || identity && !identity.revoked_at, 'portal_not_found', 404)
    insist(owner || identity?.consent_at && identity.consent_version === p.notice_version, 'portal_consent_required', 403)
    if (door === 'completion' || door === 'certificate.pdf') {
      insist(identity, 'portal_identity_not_found', 404)
      return await portalCompletion(env, request, { portal: id, identity: identity.id, account: session.operator.id }, door === 'certificate.pdf')
    }
    if (door === 'assessment' || door === 'assessment.json') {
      insist(identity, 'portal_identity_not_found', 404)
      return await portalAssessment(env, request, id, identity.id, session.operator.id, door === 'assessment.json')
    }
    if (door === 'learning' || door === 'progress.json') {
      insist(identity, 'portal_identity_not_found', 404)
      return await portalLearning(env, request, id, identity.id, session.operator.id, door === 'progress.json')
    }
    const admin = owner || !!await one(env, 'SELECT 1 FROM beam_portal_administrators WHERE portal_id=? AND identity_id=? AND revoked_at IS NULL', id, identity?.id ?? '')
    if (door === 'enroll') {
      insist(request.method === 'POST', 'method_not_allowed', 405)
      insist(admin, 'portal_administrator_required', 403)
      const input = await Input.from(request), learner = input.text('identity'), revision = input.text('revision')
      insist(await one(env, 'SELECT 1 FROM beam_portal_identities WHERE portal_id=? AND id=? AND consent_at IS NOT NULL AND revoked_at IS NULL AND operator_id IS NOT NULL', id, learner), 'portal_identity_not_found', 404)
      insist(await one(env, "SELECT 1 FROM beam_portal_shares s JOIN beam_course_revisions r ON r.id=s.revision_id JOIN beam_courses c ON c.id=r.course_id WHERE s.portal_id=? AND s.revision_id=? AND s.revoked_at IS NULL AND r.state IN ('published','superseded') AND c.retired_at IS NULL AND c.archived_at IS NULL", id, revision), 'portal_revision_not_found', 404)
      const enrollment = newId(), principal = owner ? (await currentActor(env, request))?.id : identity!.id
      insist(principal, 'portal_actor_unavailable', 403)
      await commit(env, [stmt(env, `INSERT OR IGNORE INTO beam_portal_enrollments(id,portal_id,identity_id,revision_id,enrolled_by,enrolled_at)
        SELECT ?,i.portal_id,i.id,s.revision_id,?,? FROM beam_portal_identities i
        JOIN beam_portal_shares s ON s.portal_id=i.portal_id AND s.revision_id=? AND s.revoked_at IS NULL
        JOIN beam_course_revisions r ON r.id=s.revision_id AND r.state IN ('published','superseded')
        JOIN beam_courses c ON c.id=r.course_id AND c.retired_at IS NULL AND c.archived_at IS NULL
        WHERE i.portal_id=? AND i.id=? AND i.consent_at IS NOT NULL AND i.revoked_at IS NULL AND i.operator_id IS NOT NULL
        AND (?=1 OR EXISTS(SELECT 1 FROM beam_portal_administrators a JOIN beam_portal_identities admin ON admin.portal_id=a.portal_id AND admin.id=a.identity_id WHERE a.portal_id=i.portal_id AND a.identity_id=? AND a.revoked_at IS NULL AND admin.revoked_at IS NULL AND admin.consent_at IS NOT NULL AND admin.operator_id=?))`, enrollment, principal, now(), revision, id, learner, owner ? 1 : 0, identity?.id ?? '', session.operator.id)], { actor: principal, action: 'portal.enroll', subject: id, detail: { identity: learner, revision } })
      const planned = await one(env, 'SELECT id,revision_id AS revision FROM beam_portal_enrollments WHERE portal_id=? AND identity_id=? AND revision_id=?', id, learner, revision)
      insist(planned, 'portal_enrollment_conflict', 409)
      return json(planned)
    }
    insist(['GET', 'HEAD'].includes(request.method), 'method_not_allowed', 405)
    let data: unknown
    if (door === 'catalog') data = { portal: id, name: p.name, kind: p.kind, state: 'preparation', theme: JSON.parse(p.theme_json), courses: await all(env, "SELECT r.id AS revision,r.title,r.number FROM beam_portal_shares s JOIN beam_course_revisions r ON r.id=s.revision_id JOIN beam_courses c ON c.id=r.course_id WHERE s.portal_id=? AND s.revoked_at IS NULL AND r.state IN ('published','superseded') AND c.retired_at IS NULL AND c.archived_at IS NULL ORDER BY r.title,r.number", id), enrollments: identity ? await all(env, 'SELECT e.id,e.revision_id AS revision FROM beam_portal_enrollments e JOIN beam_portal_shares s ON s.portal_id=e.portal_id AND s.revision_id=e.revision_id WHERE e.portal_id=? AND e.identity_id=? AND s.revoked_at IS NULL ORDER BY e.id', id, identity.id) : [] }
    else {
      insist(admin, 'portal_administrator_required', 403)
      data = door === 'roster' ? { identities: await all(env, 'SELECT id,display_name AS name,consent_at AS consentAt FROM beam_portal_identities WHERE portal_id=? AND revoked_at IS NULL AND consent_at IS NOT NULL AND operator_id IS NOT NULL ORDER BY id', id) } : { enrollments: await all(env, 'SELECT e.id,e.identity_id AS identity,e.revision_id AS revision,e.enrolled_at AS enrolledAt,(SELECT id FROM beam_portal_completions completion WHERE completion.enrollment_id=e.id) AS completion,(SELECT completed_at FROM beam_portal_completions completion WHERE completion.enrollment_id=e.id) AS completedAt,(SELECT COUNT(*) FROM beam_portal_attempts attempt WHERE attempt.enrollment_id=e.id) AS attempts,(SELECT MAX(passed) FROM beam_portal_attempts attempt WHERE attempt.enrollment_id=e.id) AS assessmentPassed,(SELECT COUNT(*) FROM beam_portal_lesson_progress progress WHERE progress.enrollment_id=e.id) AS lessonsRead,(SELECT COUNT(*) FROM beam_lesson_revisions l WHERE l.course_revision_id=e.revision_id) AS totalLessons FROM beam_portal_enrollments e JOIN beam_portal_identities i ON i.id=e.identity_id AND i.portal_id=e.portal_id JOIN beam_portal_shares s ON s.portal_id=e.portal_id AND s.revision_id=e.revision_id WHERE e.portal_id=? AND i.revoked_at IS NULL AND i.consent_at IS NOT NULL AND s.revoked_at IS NULL ORDER BY e.id', id) }
    }
    return request.method === 'HEAD' ? new Response(null, { headers: { 'cache-control': 'no-store' } }) : json(data)
  } catch (error) {
    if (error instanceof BeamError) return json({ error: error.code }, error.status)
    throw error
  }
}

export async function listPortals(env: Bindings, actor: Actor) {
  humanOwner(actor)
  return { portals: await all(env, 'SELECT id,kind,name,created_at AS createdAt FROM beam_enterprise_portals ORDER BY created_at,id') }
}

export async function saveEnterpriseTheme(env: Bindings, actor: Actor, input: Input) {
  humanOwner(actor)
  const id = input.text('portal'), p = await portal(env, id), previous = JSON.parse(p.theme_json)
  const theme = { ...await readThemeInput(env, input, previous), version: previous.version + 1 }
  await commit(env, [stmt(env, 'UPDATE beam_enterprise_portals SET theme_json=? WHERE id=?', JSON.stringify(theme), id)], { actor, action: 'portal.theme', subject: id, detail: { primary: theme.primary, accent: theme.accent } })
  return { portal: id, theme }
}

/** Publishing a changed disclosure closes access until each learner accepts that exact version. */
export async function savePortalNotice(env: Bindings, actor: Actor, input: Input) {
  humanOwner(actor)
  const id = input.text('portal'), p = await portal(env, id)
  const expected = input.integer('version', { min: 0 })
  insist(expected === p.notice_version, 'portal_notice_changed', 409)
  const disclosure = Object.fromEntries(['operatorName', 'purpose', 'collectedData', 'reportingRecipients', 'providers', 'retentionAndHolds', 'certificateEffects', 'withdrawal'].map(key => [key, input.text(key, { max: 2000 })]))
  const version = p.notice_version + 1, at = now()
  try { await env.DB.batch([
    stmt(env, 'INSERT INTO beam_portal_notices VALUES(?,?,?,?,?)', id, version, JSON.stringify(disclosure), actor.id, at),
    stmt(env, 'UPDATE beam_enterprise_portals SET notice_version=? WHERE id=? AND notice_version=?', version, id, expected),
    stmt(env, 'UPDATE beam_portal_identities SET consent_at=NULL WHERE portal_id=?', id),
    stmt(env, 'UPDATE beam_portal_administrators SET revoked_at=COALESCE(revoked_at,?) WHERE portal_id=?', at, id),
    stmt(env, 'INSERT INTO beam_audit(at,actor,action,subject,detail) VALUES(?,?,?,?,?)', at, actor.id, 'portal.notice', id, JSON.stringify({ noticeVersion: version, outcome: 'published' })),
  ]) } catch (error) {
    if (String(error).includes('UNIQUE constraint failed: beam_portal_notices')) throw new BeamError('portal_notice_changed', 409)
    throw error
  }
  return { portal: id, noticeVersion: version }
}
