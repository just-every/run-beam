// Shared primitives: typed errors, ids, time and small D1 helpers.
import type { Bindings } from '../auth.server'

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
export async function commit(env: Bindings, statements: D1PreparedStatement[], audit: { actor: string; action: string; subject: string; detail?: unknown }) {
  await env.DB.batch([
    ...statements,
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) VALUES (?, ?, ?, ?, ?)', now(), audit.actor, audit.action, audit.subject, JSON.stringify(audit.detail ?? {})),
  ])
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
