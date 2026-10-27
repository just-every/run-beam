// The sole fake is the Entra HTTPS edge. The Worker still performs discovery,
// PKCE, state and cookie correlation, RSA signature verification and Base admission.
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
export const tenantId = '10000000-0000-4000-8000-000000000001'
export const clientId = '10000000-0000-4000-8000-000000000002'
export const foreignTenant = '20000000-0000-4000-8000-000000000001'
export const externalId = '10000000-0000-4000-8000-000000000003'
export const externalGroup = '10000000-0000-4000-8000-000000000004'
export const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`
export const scimToken = 'synthetic-beam-9001'
export const bindings = { ENTRA_TENANT_ID: tenantId, ENTRA_CLIENT_ID: clientId, ENTRA_CLIENT_SECRET: 'synthetic-beam-9002', ENTRA_SCIM_TOKEN: scimToken }
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
export function entraEdge() {
 const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
 const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-beam-3', alg: 'RS256', use: 'sig' }
 const grants = new Map(); let serial = 4
 const discovery = { issuer, authorization_endpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`, token_endpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, jwks_uri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys', response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code'], id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_post'], code_challenge_methods_supported: ['S256'] }
 return {
  grant(start, claims = {}, { invalidSignature = false } = {}) {
   const code = `synthetic-beam-${serial++}`
   grants.set(code, { nonce: start.searchParams.get('nonce'), challenge: start.searchParams.get('code_challenge'), redirectUri: start.searchParams.get('redirect_uri'), claims, invalidSignature })
   return code
  },
  async outboundService(request) {
   if (request.url === `${issuer}/.well-known/openid-configuration`) return Response.json(discovery)
   if (request.url === discovery.jwks_uri) return Response.json({ keys: [jwk] })
   if (request.url !== discovery.token_endpoint) return null
   const form = new URLSearchParams(await request.text()), grant = grants.get(form.get('code'))
   if (!grant || form.get('client_id') !== clientId || form.get('client_secret') !== bindings.ENTRA_CLIENT_SECRET || !form.get('code_verifier') || form.get('redirect_uri') !== grant.redirectUri || createHash('sha256').update(form.get('code_verifier')).digest('base64url') !== grant.challenge) return Response.json({ error: 'invalid_grant' }, { status: 400 })
   grants.delete(form.get('code'))
   const at = Math.floor(Date.now() / 1000)
   const payload = { iss: issuer, aud: clientId, sub: 'synthetic-beam-10', nonce: grant.nonce, iat: at, exp: at + 300, ...grant.claims }
   const input = `${encode({ typ: 'JWT', alg: 'RS256', kid: jwk.kid })}.${encode(payload)}`
   const signature = sign('RSA-SHA256', Buffer.from(input), privateKey)
   if (grant.invalidSignature) signature[0] ^= 1
   return Response.json({ token_type: 'Bearer', expires_in: 300, id_token: `${input}.${signature.toString('base64url')}` })
  },
 }
}
