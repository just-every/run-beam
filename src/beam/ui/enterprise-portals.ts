import { card, h, hidden, rows, type Html } from './html'

// The external entry frame reuses Beam's cards and typography without employee navigation.
function frame(title: string, body: Html, status = 200) {
  return new Response(h`<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Beam</title><link rel="stylesheet" href="/site/fonts.css"><link rel="stylesheet" href="/site/theme.css"><link rel="stylesheet" href="/beam.css"></head><body><div class="app bare"><header class="rail"><p>External training</p></header><main class="work"><h1>${title}</h1>${body}</main></div></body></html>`.html, {
    status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow',
      'content-security-policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" },
  })
}
const disclosureFields = [
  ['operatorName', 'Training operator'], ['purpose', 'Learning purpose'], ['collectedData', 'Identity and learning data'],
  ['reportingRecipients', 'Reporting recipients'], ['providers', 'Service providers'], ['retentionAndHolds', 'Retention and holds'],
  ['certificateEffects', 'Certificate consequences'], ['withdrawal', 'Withdrawing consent'],
]
export function portalEntryPage(id: string, door: string, data: Record<string, any>) {
  const base = `/app/portal/${id}`
  if (door === 'claim') return frame(data.name, card('Claim your invitation', h`<p>This invitation is for your verified account. Claiming it keeps your identity separate from employee records and other portals. It does not accept the training notice or grant administration.</p><form method="post" action="${base}/claim">${hidden('identity', data.identity)}<button type="submit">Claim invitation</button></form>`))
  if (door === 'catalog') return frame(data.name, h`<p class="lede">Shared course catalog</p><p><a href="${base}/consent">Your consent</a></p>${card('Shared revisions', h`<p>These courses are available for enrollment planning. External lesson delivery is not available yet.</p>${data.courses.length ? rows(data.courses.map((course: any) => ({ title: course.title, meta: `Revision ${course.number}` }))) : h`<p>No courses are shared with this portal.</p>`}`)}`)
  return frame(data.name, h`<p class="lede">Your portal consent</p>${data.accessClosed ? h`<p class="flash">Portal admission is closed. You can still withdraw consent here.</p>` : ''}${card('Training notice', h`<p>Notice version ${data.noticeVersion}</p><p>${data.consentText}</p>${data.notice ? disclosureFields.map(([key, label]) => h`<h3>${label}</h3><p>${data.notice[key]}</p>`) : h`<p>The operator has not published a complete notice. Consent cannot be accepted yet.</p>`}`)}${card('Your decision', h`<p role="status">${data.accepted ? 'Consent accepted.' : 'Consent not accepted.'}</p>${data.decision ? h`<p>Last decision: ${data.decision.action === 'accept' ? 'accepted' : 'withdrawn'}, notice version ${data.decision.noticeVersion}, ${new Date(data.decision.at).toISOString()}.</p>` : ''}${!data.accessClosed && data.notice && !data.accepted ? h`<form method="post" action="${base}/consent">${hidden('noticeVersion', data.noticeVersion)}<label class="check"><input type="checkbox" name="accept" value="true" required> I accept this portal’s training notice.</label><button type="submit">Accept training notice</button></form>` : ''}<form method="post" action="${base}/consent">${hidden('withdraw', 'true')}<button type="submit" class="secondary">Withdraw consent</button></form><p>Withdrawal closes this portal’s learning and administrator access. It does not erase retained records or change consent in another portal. Renewed consent never restores administrator grants.</p>${data.accepted && !data.accessClosed ? h`<p><a href="${base}/catalog">Open shared catalog</a></p>` : ''}`)}`)
}
export function portalEntryError(code: string, status: number, consent?: string) {
  const message = code === 'employee_identity_link_required' ? 'This account has an employee identity. Linking needs a separate review; no identity has been merged.' : code === 'portal_notice_changed' ? 'The training notice changed. Review the current notice before accepting.' : code === 'portal_consent_required' ? 'Review and accept this portal’s training notice before opening its catalog.' : 'This portal request is unavailable for your account. No access has been granted.'
  return frame('Portal access unavailable', h`<p role="alert">${message}</p>${consent ? h`<p><a href="${consent}">Review your consent</a></p>` : ''}`, status)
}
