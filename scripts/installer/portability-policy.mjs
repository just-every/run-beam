// The installation archive policy `rer export` and `rer import` load (localPortability policyModule).
// OPS-007 (ct 20 Oct 16:55Z): an archive never carries a verifier. Application credential secrets and the tokens of
// certificate verification links and restricted report links are kept only as hashes, and the archive replaces each
// hash with `withheld` (`withheld:<id>` where the column is unique), which no token can match. Every other column
// travels unchanged: who issued, scoped, rotated or revoked the grant, and when. On restore, migration 0070 marks the
// grants it brings back disabled until the owner reissues them (rotate a credential; create a new link). Nothing here
// changes the archive's secret or configuration inventory, so archives made before this policy still restore.
export const WITHHELD = 'withheld'
const LINKS = new Set(['beam_certificate_links', 'beam_dashboard_shares'])

export default {
  product: 'learning/beam',
  excludeTables: ['beam_lti_tokens'],
  buckets: { files: { prefix: 'sha256/' } },
  requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'],
  exportRow(table, row) {
    if (table === 'beam_lti_platform_keys') return { ...row, private_cipher: WITHHELD }
    if (table === 'beam_webhook_subscriptions') return { ...row, key_cipher: WITHHELD, enabled: 0 }
    if (table === 'beam_app_credentials') return { ...row, secret_sha256: WITHHELD }
    // A named report viewer has no token; only link rows carry one.
    if (LINKS.has(table) && row.token_hash !== null) return { ...row, token_hash: `${WITHHELD}:${row.id}` }
    return row
  },
}
