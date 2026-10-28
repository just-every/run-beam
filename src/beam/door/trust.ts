import type { Bindings } from '../../auth.server.ts'
import type { Trust } from '../../modules/agent-door/index.ts'

/** Owner claim, Business settings and agent access share one installation ring. */
export function installationTrust(env: Bindings): Trust | null {
  const issuer=env.RER_OWNER_CLAIM_ISSUER, installationId=env.RER_OWNER_CLAIM_INSTALLATION_ID
  const publicKeys=env.RER_OWNER_CLAIM_PUBLIC_KEYS
  if (![issuer,installationId,publicKeys,env.RER_OWNER_CLAIM_APP_ORIGIN].some(Boolean)) return null
  const appOrigin=env.RER_OWNER_CLAIM_APP_ORIGIN ?? env.AUTH_ORIGIN
  if (!issuer || !installationId || !publicKeys || appOrigin!==env.AUTH_ORIGIN) throw new Error('Incomplete or inconsistent installation trust configuration')
  return {issuer,installationId,appOrigin,publicKeys:JSON.parse(publicKeys)}
}
