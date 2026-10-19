// Server-rendered forms carry only retained plan ids and reviewed fingerprints.
// Calls enter the same public operator handler with the original owner cookie
// and CSRF headers; there is no privileged second apply implementation.
import type { Bindings } from '../../auth.server'
import { BeamError, insist } from '../core'
import { beamImportDoor, importNamespace } from './door'

export async function operatorCall(env: Bindings, request: Request, action: string, body: unknown): Promise<any> {
  const headers = new Headers(request.headers)
  headers.set('Content-Type', 'application/json')
  headers.set('X-Import-Source', importNamespace)
  headers.delete('Content-Length')
  const response = await beamImportDoor(new Request(new URL(`/api/operator/import/${action}`, env.AUTH_ORIGIN), {
    method: 'POST', headers, body: JSON.stringify(body),
  }), env)
  insist(response, 'import_door_unavailable', 503)
  const value = await response.json() as any
  if (!response.ok) throw new BeamError(value.error, response.status, value.details)
  return value
}
