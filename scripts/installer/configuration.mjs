import { normalizeEmail, isLoopbackHost } from '../../src/modules/operator-auth/index.mjs'
import { parseAddress } from '../../src/modules/mail/src/core/validation.mjs'

// OPS-007: offline diagnosis only. Never return a supplied value or an exception message.
export function configurationIssues(env) {
  const issues = []
  const issue = (setting, action) => issues.push({ setting, action })
  const local = env.AUTH_LOCAL === 'true'
  try {
    const url = new URL(env.AUTH_ORIGIN)
    if (url.origin !== env.AUTH_ORIGIN || url.username || url.password || (local ? !isLoopbackHost(url.hostname) || !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:')) throw Error()
  } catch { issue('AUTH_ORIGIN', local ? 'Set an exact HTTP or HTTPS loopback origin, without a path, query or fragment.' : 'Set the exact HTTPS installation origin, without a path, query or fragment.') }
  try { normalizeEmail(env.OWNER_EMAIL) } catch { issue('OWNER_EMAIL', 'Set the owner mailbox to a valid email address.') }
  for (const key of ['SESSION_SECRET', 'SETUP_TOKEN']) {
    if (key === 'SETUP_TOKEN' && env[key] === undefined) continue // Base permits an already-claimed installation without this token.
    if (typeof env[key] !== 'string' || env[key].length < 32 || env[key].length > 1024) issue(key, 'Set a private random value of 32–1024 characters in the installation secret store.')
  }
  if (env.AUTH_LOCAL !== undefined && !['true', 'false'].includes(env.AUTH_LOCAL)) issue('AUTH_LOCAL', 'Use true for a local runtime or false for a hosted installation.')
  if (local || env.RER_DEMO === '1') return issues // These runtimes intentionally use Base development mail.
  if (!['resend', 'sendgrid', 'cloudflare'].includes(env.MAIL_PROVIDER)) issue('MAIL_PROVIDER', 'Select resend, sendgrid or cloudflare for hosted sign-in mail.')
  if (typeof env.MAIL_FROM !== 'string' || !env.MAIL_FROM.trim()) issue('MAIL_FROM', 'Set a single sender mailbox verified with the selected mail provider.')
  else {
    // Use the same address validation as a real send, without constructing or sending a message.
    try {
      const { email } = parseAddress(env.MAIL_FROM)
      if (!email) throw Error()
    } catch { issue('MAIL_FROM', 'Set a single valid sender mailbox verified with the selected mail provider.') }
  }
  if (typeof env.MAIL_API_KEY !== 'string' || !env.MAIL_API_KEY.trim() || env.MAIL_API_KEY.length > 4096 || /[\s\x00-\x1f\x7f]/.test(env.MAIL_API_KEY)) issue('MAIL_API_KEY', 'Set the selected provider API credential in the installation secret store; use a nonempty value without whitespace, at most 4096 characters.')
  if (env.MAIL_PROVIDER === 'cloudflare' && (typeof env.MAIL_ACCOUNT_ID !== 'string' || !/^[a-f0-9]{32}$/i.test(env.MAIL_ACCOUNT_ID))) issue('MAIL_ACCOUNT_ID', 'Set the Cloudflare mail account id to its 32 hexadecimal characters.')
  return issues
}
