// ORG-011: human-issued local credentials, admitted through Base's password seam.
import { operatorAuth, type Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { commit, insist, newId, now, one, sha256Hex, stmt } from './core'
import { Input } from './input'

const ITERATIONS = 100000
const hex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
const random = () => hex(crypto.getRandomValues(new Uint8Array(24)))
async function digest(secret: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'])
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: ITERATIONS }, key, 256)))
}
const same = (left: string, right: string) => {
  let difference = left.length ^ right.length
  for (let i = 0; i < Math.max(left.length, right.length); i++) difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0)
  return difference === 0
}
const recovery = `EXISTS(SELECT 1 FROM beam_admin_grants g WHERE g.member_id=m.id AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?))`

export async function configureFrontline(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const enabled = input.flag('enabled')
  await commit(env, [stmt(env, 'INSERT INTO beam_frontline_policy VALUES(1,?,1) ON CONFLICT(singleton) DO UPDATE SET enabled=excluded.enabled,revision=revision+1', enabled ? 1 : 0),
    ...(!enabled ? [stmt(env, "UPDATE oa_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE kind='password' AND operator_id IN (SELECT operator_id FROM beam_members m JOIN beam_frontline_credentials c ON c.member_id=m.id)", now())] : [])],
  { actor, action: 'frontline.policy', subject: 'frontline', detail: { enabled } })
  return { enabled }
}

async function target(env: Bindings, actor: Actor, member: string) {
  insist(!actor.agent, 'human_required', 403)
  const row = await one<{ id: string; operator_id: string | null; employee_id: string; name: string; email: string | null; username: string | null; recovery: number; role: string | null; employment: string }>(env,
    `SELECT m.*,o.role,${recovery} AS recovery FROM beam_members m LEFT JOIN oa_operators o ON o.id=m.operator_id WHERE m.id=? AND m.erased_at IS NULL AND m.erasure_pending=0`, now(), member)
  insist(row, 'person_not_found', 404)
  insist(actor.owner || !!await one(env, 'SELECT 1 FROM beam_team_members WHERE member_id=? AND team_id IN (SELECT value FROM json_each(?))', member, JSON.stringify(actor.managedTeams)), 'outside_your_team', 403)
  insist(row.role !== 'owner' && row.role !== 'admin' && !row.recovery, 'workplace_recovery_required', 403)
  insist(row.employment !== 'terminated', 'person_inactive', 409)
  return row
}

export async function issueFrontline(env: Bindings, actor: Actor, input: Input) {
  const person = await target(env, actor, input.text('member'))
  const existing = await one(env, 'SELECT 1 FROM beam_frontline_credentials WHERE member_id=?', person.id)
  // Only the owner provisions access; a manager can reset an already-provisioned teammate.
  insist(actor.owner || existing, 'owner_required', 403)
  const username = (input.text('username', { optional: true }) || person.username || '').toLowerCase()
  insist(/^[a-z0-9._-]{3,40}$/.test(username), 'invalid_username')
  insist(person.employee_id, 'employee_id_required', 409)
  insist(!await one(env, 'SELECT 1 FROM beam_members WHERE lower(username)=? AND id<>?', username, person.id), 'username_in_use', 409)
  const mode = input.text('mode', { optional: true }) || 'password'
  insist(mode === 'password' || mode === 'pin', 'invalid_method')
  const secret = random(), salt = random(), hash = await digest(secret, salt), expiresAt = now() + 7 * 86400000
  const operator = person.operator_id || newId()
  const statements = []
  if (!person.operator_id) {
    insist(!person.email, 'invite_workplace_account_first', 409)
    // Internal non-deliverable account key. It is never a mailbox or a recovery route.
    statements.push(stmt(env, "INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) VALUES(?,?,?,'member','active',1,?)", operator, `${operator}@frontline.invalid`, person.name, now()))
  }
  statements.push(stmt(env, 'UPDATE beam_members SET operator_id=?,username=? WHERE id=?', operator, username, person.id),
    stmt(env, 'UPDATE oa_operators SET version=version+1 WHERE id=?', operator),
    stmt(env, 'UPDATE oa_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE operator_id=?', now(), operator),
    stmt(env, `INSERT INTO beam_frontline_credentials(member_id,salt,hash,initial_expires,mode,failures,locked_until,revision) VALUES(?,?,?,?,?,0,0,1)
      ON CONFLICT(member_id) DO UPDATE SET salt=excluded.salt,hash=excluded.hash,initial_expires=excluded.initial_expires,mode=excluded.mode,failures=0,locked_until=0,revision=revision+1`, person.id, salt, hash, expiresAt, mode))
  await commit(env, statements, { actor, action: 'frontline.reset', subject: person.id, detail: { mode, expiresAt } })
  return { username, initialSecret: secret, expiresAt, mode }
}

export async function unlockFrontline(env: Bindings, actor: Actor, input: Input) {
  const person = await target(env, actor, input.text('member'))
  await commit(env, [stmt(env, 'UPDATE beam_frontline_credentials SET failures=0,locked_until=0 WHERE member_id=?', person.id)], { actor, action: 'frontline.unlock', subject: person.id })
  return { id: person.id }
}

export async function frontlineResponse(env: Bindings, request: Request): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/auth/frontline') return null
  const answer = (body: unknown, status: number, cookie?: string) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...(cookie ? { 'set-cookie': cookie } : {}) } })
  try {
    insist(request.method === 'POST', 'method_not_allowed', 405)
    insist(request.headers.get('origin') === env.AUTH_ORIGIN, 'invalid_origin', 403)
    insist(!request.headers.has('authorization'), 'human_required', 403)
    const policy = await one<{ revision: number }>(env, 'SELECT revision FROM beam_frontline_policy WHERE singleton=1 AND enabled=1')
    insist(policy, 'method_disabled', 403)
    insist((request.headers.get('content-type') || '').startsWith('application/json'), 'unsupported_content_type', 415)
    const input = await Input.from(request)
    const username = input.text('username', { max: 40 }).toLowerCase(), secret = input.json('secret')
    insist(typeof secret === 'string' && secret.length > 0 && secret.length <= 256, 'invalid_credentials', 401)
    const device = await sha256Hex(new TextEncoder().encode(env.SESSION_SECRET + '\0' + (request.headers.get('CF-Connecting-IP') || 'unknown')))
    const window = Math.floor(now() / 600000), key = `frontline:${device}`
    const limit = await env.DB.prepare('INSERT INTO oa_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count').bind(key, window).first<{ count: number }>()
    insist(limit && limit.count <= 30, 'rate_limited', 429)
    const row = await one<{ member_id: string; salt: string; hash: string; mode: string; initial_expires: number | null; locked_until: number; revision: number; operator_id: string; status: string; role: string; recovery: number; employment: string }>(env,
      `SELECT c.*,m.operator_id,m.employment,o.status,o.role,${recovery} AS recovery FROM beam_frontline_credentials c JOIN beam_members m ON m.id=c.member_id JOIN oa_operators o ON o.id=m.operator_id
       WHERE lower(m.username)=? AND m.erased_at IS NULL AND m.erasure_pending=0`, now(), username)
    // Equal-cost verification also for unknown usernames. Public failures disclose no account details.
    const valid = same(await digest(secret, row?.salt || 'synthetic-beam-1'), row?.hash || '0'.repeat(64))
    insist(row && row.status === 'active' && row.employment !== 'terminated' && row.role !== 'owner' && row.role !== 'admin' && !row.recovery, 'invalid_credentials', 401)
    insist(row.locked_until <= now(), 'invalid_credentials', 401)
    if (!valid) {
      await env.DB.prepare('UPDATE beam_frontline_credentials SET failures=failures+1,locked_until=CASE WHEN failures+1>=5 THEN ? ELSE locked_until END WHERE member_id=? AND revision=?').bind(now() + 900000, row.member_id, row.revision).run()
      return answer({ error: 'invalid_credentials' }, 401)
    }
    if (row.initial_expires !== null) {
      insist(row.initial_expires > now(), 'invalid_credentials', 401)
      const password = input.json('newPassword')
      insist(typeof password === 'string' && password.length <= 256, 'new_password_required')
      insist(row.mode === 'pin' ? /^\d{6,}$/.test(password) : password.length >= 15, 'weak_password')
      insist(password !== secret, 'new_password_required')
      const salt = random(), hash = await digest(password, salt)
      const changed = await env.DB.prepare('UPDATE beam_frontline_credentials SET salt=?,hash=?,initial_expires=NULL,failures=0,locked_until=0,revision=revision+1 WHERE member_id=? AND revision=? AND initial_expires>? RETURNING revision').bind(salt, hash, row.member_id, row.revision, now()).first<{ revision: number }>()
      insist(changed, 'invalid_credentials', 401)
      row.revision = changed.revision
      row.salt = salt
    }
    const result = await operatorAuth(env).admitVerifiedPassword(request, row.operator_id, { returnTo: '/app/learning' })
    const current = await one(env, `SELECT 1 FROM beam_frontline_credentials c JOIN beam_frontline_policy p ON p.singleton=1 JOIN beam_members m ON m.id=c.member_id JOIN oa_operators o ON o.id=m.operator_id WHERE c.member_id=? AND c.revision=? AND c.salt=? AND p.enabled=1 AND p.revision=? AND m.employment<>'terminated' AND m.erased_at IS NULL AND m.erasure_pending=0 AND c.locked_until<=? AND o.role='member' AND o.status='active' AND NOT ${recovery}`, row.member_id, row.revision, row.salt, policy.revision, now(), now())
    if (!current) { await operatorAuth(env).signOut(new Request(request.url, { method: 'POST', headers: { origin: env.AUTH_ORIGIN, cookie: result.cookie.split(';')[0] } })); insist(false, 'invalid_credentials', 401) }
    await env.DB.prepare('UPDATE beam_frontline_credentials SET failures=0,locked_until=0 WHERE member_id=? AND revision=?').bind(row.member_id, row.revision).run()
    return answer({ returnTo: result.returnTo }, 200, result.cookie)
  } catch (error) {
    const value = error as { code?: string; status?: number }
    return answer({ error: value.code || 'invalid_credentials' }, value.status || 401)
  }
}
