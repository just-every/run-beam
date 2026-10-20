// Shared primitives: typed errors, ids, time and small D1 helpers.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'

export class BeamError extends Error {
  constructor(readonly code: string, readonly status = 400, readonly detail?: unknown) {
    super(code)
  }
}

export function insist(condition: unknown, code: string, status = 400, detail?: unknown): asserts condition {
  if (!condition) throw new BeamError(code, status, detail)
}

export const newId = () => crypto.randomUUID()
export const now = () => Date.now()

export type Row = Record<string, any>

export async function one<T = Row>(env: Bindings, sql: string, ...params: unknown[]): Promise<T | null> {
  return await env.DB.prepare(sql).bind(...params).first<T>()
}

export async function all<T = Row>(env: Bindings, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await env.DB.prepare(sql).bind(...params).all<T>()).results
}

export const stmt = (env: Bindings, sql: string, ...params: unknown[]) => env.DB.prepare(sql).bind(...params)

/** Runs the statements atomically with an audit event appended to the same batch. */
/** OPS-001: the route a change took, for the audit's via column: null for a person's own session, otherwise the
 * preparation credential's delegating session (BEAM-14) or the application credential (CONNECT-014). */
export const auditVia = (actor: Actor) => actor.app ? JSON.stringify({ kind: 'application_credential', session: actor.sessionId, name: actor.app.name }) : actor.agent ? JSON.stringify({ kind: 'agent_credential', session: actor.sessionId }) : null

/** Writes the statements and their audit event in one batch. Pass the actor itself so an agent's route is recorded. */
export async function commit(env: Bindings, statements: D1PreparedStatement[], audit: { actor: string | Actor; action: string; subject: string; detail?: unknown }) {
  const actor = typeof audit.actor === 'string' ? audit.actor : audit.actor.id, via = typeof audit.actor === 'string' ? null : auditVia(audit.actor)
  await env.DB.batch([
    ...statements,
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail, via) VALUES (?, ?, ?, ?, ?, ?)', now(), actor, audit.action, audit.subject, JSON.stringify(audit.detail ?? {}), via),
  ])
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
