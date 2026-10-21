// LTI's fixed RS256 profile; no token-supplied URLs, algorithms, keys or remote key lookup.
import { insist, now } from './core'
const enc = new TextEncoder()
export const b64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const bytes = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
export async function jwtSign(key: JsonWebKey, kid: string, claims: Record<string, unknown>) {
  const encode = (value: unknown) => b64url(enc.encode(JSON.stringify(value)))
  const input = `${encode({ alg: 'RS256', typ: 'JWT', kid })}.${encode(claims)}`
  const signer = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  return `${input}.${b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, enc.encode(input))))}`
}
export function publicKeys(value: unknown) {
  const jwks = value as { keys?: (JsonWebKey & { kid?: string; alg?: string })[] }
  insist(jwks && Array.isArray(jwks.keys) && jwks.keys.length > 0 && jwks.keys.length <= 5, 'invalid_lti_keys')
  const ids = new Set<string>()
  const keys = jwks.keys.map(key => {
    insist(key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig' && key.kid && key.kid.length <= 100 && !ids.has(key.kid) && key.e === 'AQAB' && key.n && /^[A-Za-z0-9_-]+$/.test(key.n) && key.n.length >= 342 && key.n.length <= 1366 && !['d','p','q','dp','dq','qi','oth'].some(name => name in key), 'invalid_lti_keys')
    ids.add(key.kid)
    return { kty: 'RSA', alg: 'RS256', use: 'sig', kid: key.kid, n: key.n, e: key.e }
  })
  return { keys }
}
export async function jwtVerify(token: string, keys: ReturnType<typeof publicKeys>, issuer: string, audience: string) {
  try {
    insist(token.length <= 32_000, 'invalid_lti_token', 401)
    const parts = token.split('.')
    insist(parts.length === 3, 'invalid_lti_token', 401)
    const header = JSON.parse(new TextDecoder().decode(bytes(parts[0]))), claims = JSON.parse(new TextDecoder().decode(bytes(parts[1])))
    insist(header.alg === 'RS256' && (!header.typ || header.typ === 'JWT') && !header.jku && !header.jwk && !header.x5u && !header.crit, 'invalid_lti_token', 401)
    const jwk = keys.keys.find(key => key.kid === header.kid)
    insist(jwk, 'invalid_lti_token', 401)
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    insist(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`)), 'invalid_lti_token', 401)
    const seconds = Math.floor(now() / 1000)
    insist(claims.iss === issuer && (claims.aud === audience || Array.isArray(claims.aud) && claims.aud.length === 1 && claims.aud[0] === audience) && Number.isSafeInteger(claims.iat) && Number.isSafeInteger(claims.exp) && claims.iat <= seconds + 30 && claims.iat >= seconds - 300 && claims.exp > seconds && claims.exp <= claims.iat + 300 && (!claims.nbf || claims.nbf <= seconds + 30), 'invalid_lti_token', 401)
    return claims as Record<string, any>
  } catch { insist(false, 'invalid_lti_token', 401) }
}
