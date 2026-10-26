// The installation archive policy `rer export` and `rer import` load (localPortability policyModule).
// OPS-007 (ct 20 Oct 16:55Z): an archive never carries a verifier. Application credential secrets and the tokens of
// certificate verification links and restricted report links are kept only as hashes, and the archive replaces each
// hash with `withheld` (`withheld:<id>` where the column is unique), which no token can match. Every other column
// travels unchanged: who issued, scoped, rotated or revoked the grant, and when. On restore, migration 0070 marks the
// grants it brings back disabled until the owner reissues them (rotate a credential; create a new link). Nothing here
// changes the archive's secret or configuration inventory, so archives made before this policy still restore.
import { createHash } from 'node:crypto'

export const WITHHELD = 'withheld'
const LINKS = new Set(['beam_certificate_links', 'beam_dashboard_shares'])
// Playback session ids are bearer capabilities. Keep a stable, irreversible
// evidence identity shared by sessions and events, never the original id.
const packageSession = id => /^withheld:[a-f0-9]{64}$/.test(id) ? id : `${WITHHELD}:${createHash('sha256').update(`beam-package-session\0${id}`).digest('hex')}`
const endedSession = row => {
  const endedAt = row.ended_at ?? Date.now()
  return { ...row, auth_session_id: WITHHELD, ended_at: endedAt, expires_at: Math.min(row.expires_at, endedAt) }
}

export default {
  product: 'learning/beam',
  excludeTables: ['beam_tutor_questions', 'beam_lti_tokens', 'beam_frontline_credentials', 'beam_frontline_policy'],
  buckets: { files: { prefix: 'sha256/' } },
  requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'],
  exportRow(table, row) {
    // Restored portal accounts require a new account binding, consent and owner grant.
    if (table === 'beam_tutor_grants') return { ...row, enabled: 0, version: row.enabled ? row.version + 1 : row.version }
    if (table === 'beam_portal_identities') return { ...row, operator_id: null, invited_operator_id: null, bound_at: null, consent_at: null, revoked_at: row.revoked_at ?? Date.now() }
    if (table === 'beam_portal_consent_events') return { ...row, operator_id: null }
    if (table === 'beam_portal_administrators') return { ...row, revoked_at: row.revoked_at ?? Date.now() }
    if (table === 'beam_source_ocr_config' || table === 'beam_model_config') return { ...row, key_cipher: null, enabled: 0, version: row.key_cipher || row.enabled ? row.version + 1 : row.version }
    if (table === 'beam_package_sessions') return { ...endedSession(row), id: packageSession(row.id), ...(row.initial_json.includes('cmi5Asset') ? { initial_json: '{}' } : {}) }
    if (table === 'beam_cmi5_sessions') return { ...row, session_id: packageSession(row.session_id), fetch_hash: WITHHELD, auth_hash: null, lifecycle: 'restored', busy: 0, active_registration: null }
    if (table === 'beam_cmi5_statements') return { ...row, session_id: packageSession(row.session_id) }
    if (table === 'beam_package_events') return { ...row, session_id: packageSession(row.session_id) }
    // xAPI registration and launch ids identify evidence, not authentication.
    if (table === 'beam_xapi_launches') return endedSession(row)
    if (table === 'beam_xapi_connections') return { ...row, authorization_sealed: WITHHELD, revoked_at: row.revoked_at ?? Date.now() }
    if (table === 'beam_xapi_activities') return { ...row, producer_sealed: WITHHELD, revoked_at: row.revoked_at ?? Date.now() }
    if (table === 'beam_lti_platform_keys') return { ...row, private_cipher: WITHHELD }
    if (table === 'beam_webhook_subscriptions') return { ...row, key_cipher: WITHHELD, enabled: 0 }
    if (table === 'beam_app_credentials') return { ...row, secret_sha256: WITHHELD }
    // A named report viewer has no token; only link rows carry one.
    if (LINKS.has(table) && row.token_hash !== null) return { ...row, token_hash: `${WITHHELD}:${row.id}` }
    return row
  },
}
