// Page frame and small form helpers. Every value is escaped; pages need no script.
import branding from '../../branding.json'
import type { Actor } from '../actor'
import { formatInstant } from '../time'
import { icon, type IconName } from './icons'

export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))

export type Html = { html: string }
export const raw = (html: string): Html => ({ html })
export function h(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0]
  values.forEach((value, index) => { out += render(value) + strings[index + 1] })
  return { html: out }
}
function render(value: unknown): string {
  if (value === null || value === undefined || value === false) return ''
  if (Array.isArray(value)) return value.map(render).join('')
  if (typeof value === 'object' && 'html' in (value as Html)) return (value as Html).html
  return esc(value)
}

const NAV: { href: string; label: string; show: (actor: Actor) => boolean }[] = [
  { href: '/app', label: 'My learning', show: () => true },
  { href: '/app/manage', label: 'Manage', show: actor => actor.owner || actor.roles.has('manager') },
  { href: '/app/reports', label: 'Reports', show: actor => actor.owner || actor.roles.has('manager') },
  { href: '/app/agent', label: 'Agent work', show: actor => actor.owner || ['author', 'reviewer', 'manager'].some(role => actor.roles.has(role as never)) },
  { href: '/app/courses', label: 'Courses', show: actor => actor.owner || ['author', 'reviewer', 'manager'].some(role => actor.roles.has(role as never)) },
  { href: '/app/sources', label: 'Sources', show: actor => actor.owner || ['author', 'reviewer', 'manager'].some(role => actor.roles.has(role as never)) },
  { href: '/app/paths', label: 'Paths', show: actor => actor.owner || actor.roles.has('manager') },
  { href: '/app/people', label: 'People', show: actor => actor.owner || actor.roles.has('manager') },
  { href: '/app/import', label: 'Move in', show: actor => actor.owner },
]

const headers = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'strict-origin',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; media-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
}

export function page(title: string, actor: Actor | null, body: Html, { current = '', url, status = 200 }: { current?: string; url?: URL; status?: number } = {}): Response {
  const notice = url?.searchParams.get('notice'), error = url?.searchParams.get('error')
  // Until the owner names the business every /app page leads to it, so the bar shows only the brand and the person.
  const nav = actor ? h`${actor.business ? h`<span class="business">${actor.business}</span><nav class="nav" aria-label="Main"><ul>${NAV.filter(item => item.show(actor)).map(item => h`<li><a href="${item.href}"${item.href === current ? raw(' aria-current="page"') : ''}>${item.label}</a></li>`)}</ul></nav>` : ''}<span class="who">${actor.name}</span>` : ''
  const document = h`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${branding.name}</title><link rel="icon" href="/brand/mark.svg"><link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/rer-theme.css"><link rel="stylesheet" href="/beam.css"></head><body>
<header class="top"><div class="top-inner"><a class="brand" href="/app"><img src="/brand/mark.svg" alt="" width="28" height="28"><span data-rer-name>${branding.name}</span></a>${nav}</div></header>
<main class="column">${notice ? h`<p class="flash" role="status">${notice}</p>` : ''}${error ? h`<p class="flash error" role="alert">That did not work: ${describeError(error)}</p>` : ''}${body}</main></body></html>`
  return new Response(document.html, { status, headers })
}

/** A card with the pink icon disc and its heading; the body sits beside the disc. Settings cards pass no icon. */
export function card(heading: string, body: unknown, { icon: name, id, className = '', level = 2 }: { icon?: IconName; id?: string; className?: string; level?: 2 | 3 } = {}): Html {
  const label = id ? raw(` aria-labelledby="${esc(id)}"`) : ''
  const title = raw(`<h${level} class="card-title"${id ? ` id="${esc(id)}"` : ''}>${esc(heading)}</h${level}>`)
  return name
    ? h`<section class="card with-disc${className ? ` ${className}` : ''}"${label}><span class="disc">${raw(icon(name))}</span><div class="card-body">${title}${body}</div></section>`
    : h`<section class="card${className ? ` ${className}` : ''}"${label}>${title}${body}</section>`
}

/** Rows split by a rule; a row with an href is a link with a chevron. */
export function rows(items: { title: unknown; meta?: unknown; href?: string; aside?: unknown }[]): Html {
  return h`<ul class="rows">${items.map(item => {
    const text = h`<span class="row-text"><span class="row-title">${item.title}</span>${item.meta ? h`<span class="row-meta">${item.meta}</span>` : ''}</span>${item.aside ?? ''}`
    return item.href ? h`<li><a class="row row-link" href="${item.href}">${text}${raw(icon('chevron', { size: 20, className: 'chevron' }))}</a></li>` : h`<li class="row">${text}</li>`
  })}</ul>`
}

/** Lesson progress: a pink fill on a grey track; the words stay in the row's meta text. */
export const progress = (done: number, total: number) => h`<progress class="progress" value="${done}" max="${Math.max(total, 1)}" aria-hidden="true"></progress>`

/** A status pill: Completed takes the pink highlight, the others their quiet colours. */
export const pill = (status: string, label: string) => h`<span class="status status-${status}">${label}</span>`

export const backLink = (href: string, label: string) => h`<p class="back"><a href="${href}">${raw(icon('back', { size: 20 }))}<span>${label}</span></a></p>`

/** An agent's self-reported id as a name: "claude-code" reads "Claude Code". */
export const agentName = (id: string) => id.split(/[-_\s]+/).filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ')

export const lessonCount = (done: number, total: number) => `${done} of ${total} ${total === 1 ? 'lesson' : 'lessons'}`

export const count = (value: number) => value.toLocaleString('en-AU')
export function bytes(value: number) {
  if (value < 1024) return `${count(value)} bytes`
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024, unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++ }
  return `${size.toLocaleString('en-AU', { maximumFractionDigits: size < 10 ? 1 : 0 })} ${units[unit]}`
}

const ERRORS: Record<string, string> = {
  stale_draft: 'someone else saved this draft first. Reload and apply your change again.',
  proposal_stale: 'what this proposal was prepared from changed after it was prepared, so it cannot be applied as is.',
  lessons_incomplete: 'finish every lesson first.',
  prerequisite_incomplete: 'the prerequisite course must be completed first.',
  no_attempts_remaining: 'no attempts remain. Ask your manager for another attempt.',
  named_reviewer_required: 'only the course’s named reviewer can decide this revision.',
  named_assessor_required: 'only the named assessor can decide this attempt.',
  reviewed_fingerprint_changed: 'the import changed since it was reviewed. Preview it again.',
  course_not_published: 'publish a revision of this course first.',
  business_not_configured: 'the owner must name the business and its time zone first.',
  proposal_changed: 'this proposal is not the one you reviewed. Reload the page.',
  proposal_decided: 'someone already decided this proposal.',
  practice_step_moved: 'that step was already answered. Here is where you are now.',
  answers_required: 'answer at least one question, or choose not to answer.',
  already_responded: 'you already responded to these questions.',
  questions_closed: 'these questions have closed.',
  self_assessment_refused: 'nobody can accept their own evidence. The owner or another named assessor decides it.',
  self_attestation_refused: 'nobody can attest their own attendance. Ask another manager or the owner to record it.',
  attempts_remaining: 'this person still has quiz attempts left, or has passed.',
  import_changed_since_earlier: 'some records were imported earlier with other details, for example a person who has since joined. Undo the earlier import, then preview and apply these files again.',
  already_member: 'this person already has access.',
  person_not_found: 'that person is not in Beam.',
  owner_access_fixed: 'the owner’s access cannot be changed.',
}
export const describeError = (code: string) => ERRORS[code] ?? code.replace(/_/g, ' ') + '.'

export const hidden = (name: string, value: unknown) => h`<input type="hidden" name="${name}" value="${value}">`

/** A POST form to the shared action door; returnTo may contain {id} for the created record. */
export function form(action: string, returnTo: string, fields: unknown, submit: string, { multipart = false, secondary = false, className = '' } = {}) {
  return h`<form method="post" action="/app/do/${action}"${className ? h` class="${className}"` : ''}${multipart ? raw(' enctype="multipart/form-data"') : ''}>${hidden('returnTo', returnTo)}${fields}<button type="submit"${secondary ? raw(' class="secondary"') : ''}>${submit}</button></form>`
}

// Several forms share a page, so every control gets its own id.
let sequence = 0
const uid = (name: string) => `f-${name}-${(sequence = (sequence + 1) % 1_000_000)}`

export function field(label: string, name: string, { type = 'text', value = '', required = true, hint = '' }: { type?: string; value?: unknown; required?: boolean; hint?: string } = {}) {
  const id = uid(name)
  return h`<label for="${id}">${label}</label>${hint ? h`<p class="muted hint" id="${id}-hint">${hint}</p>` : ''}<input id="${id}" type="${type}" name="${name}" value="${value}"${required ? raw(' required') : ''}${hint ? raw(` aria-describedby="${esc(id)}-hint"`) : ''}>`
}

export function area(label: string, name: string, value = '', required = true) {
  const id = uid(name)
  return h`<label for="${id}">${label}</label><textarea id="${id}" name="${name}"${required ? raw(' required') : ''}>${value}</textarea>`
}

/** Options that carry a `group` are listed under an optgroup of that name; a hint sits under the select. */
export function select(label: string, name: string, options: { value: string; label: string; group?: string }[], selected = '', { required = true, blank = '', hint = '' } = {}) {
  const id = uid(name)
  const option = (item: { value: string; label: string }) => h`<option value="${item.value}"${item.value === selected ? raw(' selected') : ''}>${item.label}</option>`
  const groups = [...new Set(options.map(item => item.group))]
  const list = groups.map(group => group === undefined ? options.filter(item => item.group === undefined).map(option) : h`<optgroup label="${group}">${options.filter(item => item.group === group).map(option)}</optgroup>`)
  return h`<label for="${id}">${label}</label><select id="${id}" name="${name}"${required ? raw(' required') : ''}${hint ? raw(` aria-describedby="${esc(id)}-hint"`) : ''}>${blank ? h`<option value="">${blank}</option>` : ''}${list}</select>${hint ? h`<p class="muted hint-after" id="${id}-hint">${hint}</p>` : ''}`
}

export function fileField(label: string, name: string, { required = false, accept = '' } = {}) {
  const id = uid(name)
  return h`<label for="${id}">${label}</label><input id="${id}" type="file" name="${name}"${accept ? h` accept="${accept}"` : ''}${required ? raw(' required') : ''}>`
}

export const checks = (legend: string, name: string, options: { value: string; label: string }[], selected: string[] = []) =>
  h`<fieldset><legend>${legend}</legend>${options.map(option => h`<label class="check"><input type="checkbox" name="${name}" value="${option.value}"${selected.includes(option.value) ? raw(' checked') : ''}> ${option.label}</label>`)}</fieldset>`

/** Due and event times; pass the business zone as `home` when `zone` is the record's own. */
export const when = (instant: number | null | undefined, zone: string, home = zone) => instant ? formatInstant(instant, zone, home) : '—'

/** Plain-text lesson bodies: blank lines separate paragraphs, "- " starts a list item, "1. " a numbered step, "# " a
 * heading. On the lesson page (`lead`), a lesson that opens with a one-line paragraph gets that line highlighted: it is
 * the line that matters. */
export function lessonText(body: string, { lead = false } = {}): Html {
  return raw(body.split(/\n{2,}/).map((block, index) => {
    const lines = block.split('\n')
    if (lines.every(line => line.startsWith('- '))) return `<ul>${lines.map(line => `<li>${esc(line.slice(2))}</li>`).join('')}</ul>`
    if (lines.every(line => /^\d+[.)] /.test(line))) return `<ol>${lines.map(line => `<li>${esc(line.replace(/^\d+[.)] /, ''))}</li>`).join('')}</ol>`
    if (block.startsWith('# ')) return `<h3>${esc(block.slice(2))}</h3>`
    if (lead && index === 0 && lines.length === 1) return `<p><mark class="hl">${esc(block)}</mark></p>`
    return `<p>${lines.map(esc).join('<br>')}</p>`
  }).join(''))
}
