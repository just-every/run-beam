import { createDependencies } from './modules/dependencies/index.mjs'
import { createIdpOwnerClaimHandler, createOwnerClaimHandler } from './modules/owner-claim/index.mjs'
import { firstRunResponse } from './base/setup'
import { fontDocumentResponse } from './base/font-response'
import { createOperatorAuth, createAuthHandler, createSignInHandler, defaultRolePolicy, devGate, devNotFound, isActiveOperator, type AuthConfig, type RolePolicy } from './modules/operator-auth/index.mjs'
import { operatorMail } from './mail.server.mjs'
import branding from './branding.json'
import type { ScheduledPolicy } from './modules/operator-auth/scheduled/index.mjs'

// The edition's declared theme (public/rer-theme.css), as Base frames link it.
const theme = { href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor }

export interface Bindings {
 /** Server-managed trusted HTTPS receiver hostnames, comma-separated; empty denies outbound webhooks. */
 BEAM_WEBHOOK_HOSTS?: string
 /** Server-admitted external LTI tool hostnames; empty denies registrations and launches. */
 BEAM_LTI_HOSTS?: string
 DB: D1Database
 /** Content-addressed source, evidence and attachment bytes. */
 FILES: R2Bucket
 /** Built browser files; hosted deploys run the Worker first (staticAssetResponse). */
 ASSETS?: Fetcher
 RER_DEPLOY_SOURCE?: string
 RER_DEPLOY_FINGERPRINT?: string
 RER_VERSION?: { id: string }
 IDENTITY_PROVIDER?: string
 AUTH_ORIGIN: string
 AUTH_LOCAL?: string
 RER_DEV_ORIGIN?: string
 /** Local runtimes only: the checkout's key gate and dev identity switch. Deploy refuses both. */
 RER_MODELS_SERVICE?: string
 RER_MODELS_KEY?: string
 RER_DEV_KEY?: string
 RER_DEV_IDENTITY?: string
 RER_INSTALLATION_ID?: string
 RER_IMPORT_DOOR?: string
 /** A signed owner claim's issuer, installation and public keys (a hosted demo's front sets them). */
 RER_OWNER_CLAIM_APP_ORIGIN?: string
 RER_OWNER_CLAIM_ISSUER?: string
 RER_OWNER_CLAIM_INSTALLATION_ID?: string
 RER_OWNER_CLAIM_PUBLIC_KEYS?: string
 /** Demo runtimes only (`rer demo`, the hosted demo): modules/demo's switch and the demo's end. Deploy refuses RER_DEMO. */
 RER_DEMO?: string
 RER_DEMO_EXPIRES?: string
 RER_MANAGEMENT_ORIGIN?: string
 OWNER_EMAIL: string
 SESSION_SECRET: string
 SETUP_TOKEN?: string
 MAIL_PROVIDER?: 'development' | 'resend' | 'sendgrid' | 'cloudflare'
 MAIL_FROM?: string
 MAIL_API_KEY?: string
 MAIL_ACCOUNT_ID?: string
}

export const runtimeBindings = (env: Bindings): Bindings => env.RER_DEV_ORIGIN && env.AUTH_LOCAL === 'true' ? { ...env, AUTH_ORIGIN: env.RER_DEV_ORIGIN } : env
export const authConfig = (env: Bindings): AuthConfig => ({ dependencies: true, origin: env.AUTH_ORIGIN, local: env.AUTH_LOCAL === 'true', OWNER_EMAIL: env.OWNER_EMAIL, SESSION_SECRET: env.SESSION_SECRET, SETUP_TOKEN: env.SETUP_TOKEN, MAIL_FROM: env.MAIL_FROM, branding: { productName: branding.name, accentColor: branding.primaryColor, signInPath: '/signin', theme: theme.href } })
// ORG-002: a learning administrator under an active grant may invite members, as Base's admin role may. Their only door
// for it is Beam's People form (src/beam/people.ts), which places each invitee in their units' teams; an invitation
// they sent stops admitting once their grant ends, because Base checks the issuer again when it is used.
const rolePolicy = (env: Bindings): RolePolicy => async input => defaultRolePolicy(input)
 || (input.action === 'operators:invite' && input.role === 'member' && isActiveOperator(input.actor)
  && !!await env.DB.prepare('SELECT 1 FROM beam_admin_grants g JOIN beam_members m ON m.id = g.member_id WHERE m.operator_id = ? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?)').bind(input.actor.id, Date.now()).first())

export function operatorAuth(env: Bindings, scheduledPolicies?: () => ScheduledPolicy[], scheduledGuard?: RolePolicy) {
 return createOperatorAuth({ db: env.DB, config: authConfig(env), mailSender: operatorMail(env), scheduledPolicies, rolePolicy: async input => await rolePolicy(env)(input) && (!scheduledGuard || await scheduledGuard(input)), clientIp: request => request.headers.get('CF-Connecting-IP') ?? '' })
}

export async function authResponse(request: Request, original: Bindings): Promise<Response | null> {
 const response = await configuredAuthResponse(request, original)
 const { provisionImportDoor } = await import('./beam/movein/provision')
 await provisionImportDoor(runtimeBindings(original))
 return response
}

async function configuredAuthResponse(request: Request, original: Bindings): Promise<Response | null> {
 const env = runtimeBindings(original), url = new URL(request.url)
 if (url.pathname.startsWith('/.well-known/rer-') || url.pathname.startsWith('/auth/dependencies/')) {
  const linked = await createDependencies({ db: env.DB, origin: env.AUTH_ORIGIN, name: branding.name, provider: env.IDENTITY_PROVIDER, local: env.AUTH_LOCAL === 'true', auth: operatorAuth(env), claimOwner: token => createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:()=>request.headers.get('CF-Connecting-IP')??''})(new Request(env.AUTH_ORIGIN+'/auth/owner-claim',{method:'POST',headers:{Host:new URL(env.AUTH_ORIGIN).host,Origin:env.AUTH_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({token})})) }).handle(request)
  if (linked) return linked
 }
 // A signed owner claim (a hosted demo's front) when its keys are configured; a missing part fails closed.
 if (url.pathname === '/auth/owner-claim' && env.RER_OWNER_CLAIM_PUBLIC_KEYS) {
  const signed = await createOwnerClaimHandler({ db: env.DB, authConfig: authConfig(env), clientIp: req => req.headers.get('CF-Connecting-IP') ?? '', issuer: env.RER_OWNER_CLAIM_ISSUER ?? '', installationId: env.RER_OWNER_CLAIM_INSTALLATION_ID ?? '', appOrigin: env.RER_OWNER_CLAIM_APP_ORIGIN ?? env.AUTH_ORIGIN, expectedEmail: env.OWNER_EMAIL, publicKeys: JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS) })(request)
  if (signed) return signed
 }
 if (url.pathname === '/auth/owner-claim') return createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:req=>req.headers.get('CF-Connecting-IP')??''})(request)
 // The key exchange answers only a local runtime holding RER_DEV_KEY.
 if (url.pathname === '/__dev/key') {
  const gate = devGate({ key: env.RER_DEV_KEY, origin: env.AUTH_ORIGIN, local: env.AUTH_LOCAL === 'true' })
  return gate ? await gate.exchange(request) ?? devNotFound() : devNotFound()
 }
 // The shared server-rendered sign-in page: plain forms that work before any script.
 if (url.pathname === '/signin') {
  const page = await createSignInHandler(operatorAuth(env), { defaultReturnTo: '/setup' })(request)
  if (page) return fontDocumentResponse(page)
 }
 // Base's own invitation door stays the owner's: everyone else invites through Beam's People form.
 if (url.pathname === '/auth/invite') {
  const session = await operatorAuth(env).getSession(request)
  if (session && session.operator.role !== 'owner') return Response.json({ error: 'forbidden' }, { status: 403 })
 }
 if (url.pathname === '/auth/policies' || url.pathname === '/auth/policy-runs' || url.pathname.startsWith('/auth/policy/')) {
  const { inactivityAuth } = await import('./beam/inactivity-scheduled')
  return createAuthHandler(await inactivityAuth(env))(request)
 }
 if (url.pathname.startsWith('/auth/')) return fontDocumentResponse(await createAuthHandler(operatorAuth(env))(request))
 if (url.pathname === '/setup' || url.pathname === '/app' || url.pathname.startsWith('/app/')) {
  const setup = await firstRunResponse(request, env, operatorAuth(env), { theme })
  if (setup) return setup
 }
 return null
}
