import type { OperatorAuth, IdentityProviders } from '../../modules/operator-auth/index.mjs'
import { createOidcProviders } from '../../modules/operator-auth/identity/oidc/index.mjs'
import { insist, one, sha256Hex } from '../core'
import { connection, issuerOf, providerId, ready, type EntraBindings } from './common'

export async function entraAuth(env: EntraBindings, baseAuth: OperatorAuth): Promise<OperatorAuth> {
 const c = await connection(env)
 if (!c || !ready(env, c)) return baseAuth
 const enabled = async () => { const current = await connection(env); return ready(env, current) && current?.revision === c.revision && await baseAuth.accounts.identityEnabled!() }
 const entra = createOidcProviders({ db: env.DB, clientIp: request => request.headers.get('CF-Connecting-IP') || '',
  policyVersion: async () => (await one<{ generation: number }>(env, 'SELECT generation FROM oa_auth_settings WHERE singleton=1'))?.generation ?? -1, enabled,
  config: { origin: env.AUTH_ORIGIN, local: env.AUTH_LOCAL === 'true', transactionSecret: await sha256Hex(new TextEncoder().encode(env.SESSION_SECRET + '\0beam-entra\0' + c.revision)), signInPath: '/signin', providers: [{ id: providerId, preset: 'microsoft', tenant: c.tenant_id, clientId: c.client_id, clientSecret: env.ENTRA_CLIENT_SECRET, tokenAuthMethod: 'client_secret_post', label: 'Microsoft Entra ID' }] },
  admission: { admit: async (request, principal, input) => {
   insist(await enabled() && principal.issuer === issuerOf(c.tenant_id) && principal.provider === providerId && principal.providerPin?.id === providerId && principal.providerPin.clientId === c.client_id, 'entra_admission_denied', 403)
   const user = await one(env, `SELECT u.id,u.operator_id,o.email FROM beam_entra_subjects a JOIN beam_entra_users u ON u.id=a.user_id JOIN oa_operators o ON o.id=u.operator_id JOIN beam_members m ON m.id=u.member_id WHERE a.subject=? AND u.active=1 AND o.role='member' AND o.status='active' AND m.employment<>'terminated' AND m.erased_at IS NULL AND m.erasure_pending=0 AND EXISTS(SELECT 1 FROM beam_entra_group_members gm JOIN beam_entra_group_roles gr ON gr.group_id=gm.group_id WHERE gm.user_id=u.id)`, principal.subject)
   insist(user, 'entra_subject_review_required', 403)
   // The verifier's issuer, subject and pins survive intact. The subject association is
   // owner-reviewed; token email, oid and group claims carry no account authority.
   const result = await baseAuth.admission.admit(request, { issuer: principal.issuer, subject: principal.subject, provider: principal.provider, providerPin: principal.providerPin, providerGeneration: principal.providerGeneration, sid: principal.sid, amr: principal.amr, associatedEmail: user.email, emailVerified: false }, input)
   // Consent may have changed while Base issued. Never release that cookie.
   if (!await enabled()) { await baseAuth.accounts.revokeSession(result.session.id); insist(false, 'entra_configuration_changed', 403) }
   return result
  } } })
 return { ...baseAuth, providers: composeProviders(baseAuth.providers, entra) }
}
function composeProviders(base: IdentityProviders | null, entra: IdentityProviders): IdentityProviders {
 if (!base) return entra
 const target = (id: string) => id === providerId ? entra : base
 return { ids: [...base.ids, ...entra.ids], signInPath: base.signInPath, callbackPaths: { ...base.callbackPaths, ...entra.callbackPaths }, begin: (r, id, i) => target(id).begin(r, id, i), callback: (r, id) => target(id).callback(r, id), list: async () => (await Promise.all([base.list(), entra.list()])).flat(), links: async () => (await Promise.all([base.links(), entra.links()])).flat(), relink: id => target(id).relink(id), unlink: id => target(id).unlink(id) }
}
