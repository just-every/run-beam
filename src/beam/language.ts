import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, commit, insist, now, one, stmt } from './core'
import type { Input } from './input'
export const LANGUAGES = ['en-US', 'es-US'] as const
export type Language = typeof LANGUAGES[number]
export function supportedLanguage(value: string | null | undefined): Language | null {
  if (/^es(?:-US)?$/i.test(value ?? '')) return 'es-US'
  if (/^en(?:-US)?$/i.test(value ?? '')) return 'en-US'
  return null
}
/** Unsupported HRIS/directory preferences fall through without losing their original stored value.
 * Conflicting team defaults use the lowest stable team id; location takes precedence over every team. */
export async function languagePreference(env: Bindings, member: string) {
  const person = await one(env, 'SELECT language,location FROM beam_members WHERE id=?', member)
  const explicit = supportedLanguage(person?.language)
  if (explicit) return { language: explicit, source: 'person' }
  const location = person?.location ? await one(env, "SELECT language FROM beam_language_defaults WHERE kind='location' AND scope=?", person.location) : null
  if (location) return { language: location.language as Language, source: 'location' }
  const team = await one(env, "SELECT d.language FROM beam_language_defaults d JOIN beam_team_members m ON m.team_id=d.scope WHERE d.kind='team' AND m.member_id=? ORDER BY d.scope LIMIT 1", member)
  if (team) return { language: team.language as Language, source: 'team' }
  const installation = await one(env, "SELECT language FROM beam_language_defaults WHERE kind='installation' AND scope='' ")
  return { language: (installation?.language ?? 'en-US') as Language, source: 'installation' }
}
export async function setMyLanguage(env: Bindings, actor: Actor, input: Input) {
  insist(!actor.agent && !actor.viewAs, 'human_session_required', 403)
  const value = input.text('language', { max: 16 }), language = value === 'default' ? null : supportedLanguage(value)
  insist(value === 'default' || language, 'unsupported_language')
  await commit(env, [stmt(env, 'UPDATE beam_members SET language=? WHERE id=?', language, actor.id)], { actor, action: 'language.change', subject: actor.id, detail: { language } })
  return await languagePreference(env, actor.id)
}
export async function setLanguageDefault(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  insist(!actor.agent, 'human_session_required', 403)
  const kind = input.text('kind'), scope = input.text('scope', { optional: true, max: 160 }), language = supportedLanguage(input.text('language', { max: 16 }))
  insist(['installation', 'team', 'location'].includes(kind) && language, 'invalid_language_default')
  if (kind === 'installation') insist(scope === '', 'invalid_language_scope')
  else if (kind === 'team') insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id=?', scope), 'team_not_found', 404)
  else insist(scope && await one(env, 'SELECT 1 FROM beam_members WHERE location=?', scope), 'location_not_found', 404)
  await commit(env, [stmt(env, 'INSERT INTO beam_language_defaults VALUES(?,?,?,?,?) ON CONFLICT(kind,scope) DO UPDATE SET language=excluded.language,updated_by=excluded.updated_by,updated_at=excluded.updated_at', kind, scope, language, actor.id, now())], { actor, action: 'language.default', subject: scope || 'installation', detail: { kind, scope, language } })
  return { kind, scope, language }
}
export async function languageSettings(env: Bindings, actor: Actor) {
  const preference = await languagePreference(env, actor.id)
  return { ...preference, defaults: actor.owner ? await all(env, 'SELECT kind,scope,language FROM beam_language_defaults ORDER BY kind,scope') : undefined }
}
