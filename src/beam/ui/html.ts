import { describeError } from './errors'
export { describeError } from './errors'
import { t } from '../messages'
import type { Language } from '../language'
// Page frame and small form helpers. Every value is escaped; pages need no script except the quiz's countdown and
// matching drag-and-drop.
import branding from '../../branding.json'
import type { Actor } from '../actor'
import { formatClock, formatInstant, formatWeekday } from '../time'
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

// The rail, in the order a manager works; each item shows only to the roles that can open it. Managers open on Manage,
// so it leads their rail and their own learning follows the work; everyone else's rail starts at My learning.
const preparer = (actor: Actor) => actor.owner || ['author', 'reviewer', 'manager'].some(role => actor.roles.has(role as never))
const manager = (actor: Actor) => actor.owner || actor.roles.has('manager')
// A learning administrator (ORG-002) opens People, Courses and Reports for their units.
const administrator = (actor: Actor) => actor.adminUnits.length > 0
// A course's own author (ORG-003) opens Courses for those courses.
const courseAuthor = (actor: Actor) => actor.authorOf.length > 0
type NavItem = { href: string; label: string; icon: IconName; show: (actor: Actor) => boolean; count?: (shell: Shell) => number }
const LEARNING: NavItem = { href: '/app/learning', label: 'My learning', icon: 'home', show: () => true }
const NAV: NavItem[] = [
  { href: '/app/manage', label: 'Manage', icon: 'document', show: actor => manager(actor) || !!actor.grants.reports },
  { href: '/app/people', label: 'People', icon: 'people', show: actor => manager(actor) || administrator(actor) || !!actor.grants.people, count: shell => shell.people },
  { href: '/app/courses', label: 'Courses', icon: 'book', show: actor => preparer(actor) || administrator(actor) || courseAuthor(actor) || !!actor.grants.courses },
  { href: '/app/paths', label: 'Paths', icon: 'route', show: manager },
  { href: '/app/automation', label: 'Automation', icon: 'route', show: actor => actor.owner || administrator(actor) },
  { href: '/app/sources', label: 'Sources', icon: 'database', show: preparer },
  { href: '/app/agent', label: 'Agent work', icon: 'spark', show: preparer, count: shell => shell.waiting },
  { href: '/app/notifications', label: 'Notification rules', icon: 'bell', show: actor => actor.owner },
  { href: '/app/announcements', label: 'Announcements', icon: 'bell', show: actor => manager(actor) || administrator(actor) || !!actor.instructor },
  { href: '/app/reports', label: 'Reports', icon: 'chart', show: actor => manager(actor) || administrator(actor) || !!actor.grants.reports },
  LEARNING,
  { href: '/app/catalog', label: 'Catalog', icon: 'book', show: () => true },
  { href: '/app/skills', label: 'Skills', icon: 'route', show: actor => !!actor.business },
  { href: '/app/sessions', label: 'Sessions', icon: 'calendar', show: () => true },
  { href: '/app/recognition', label: 'Recognition', icon: 'rosette', show: actor => !!actor.business },
  { href: '/app/external', label: 'Certificates', icon: 'clipboard', show: actor => !!actor.business },
  { href: '/app/evidence', label: 'Shared evidence', icon: 'document', show: actor => actor.auditor },
  { href: '/app/integrations', label: 'Integrations', icon: 'plug', show: actor => actor.owner },
  { href: '/app/access', label: 'Access', icon: 'database', show: actor => actor.owner },
  { href: '/app/audit', label: 'Audit', icon: 'clipboard', show: actor => actor.owner || administrator(actor) || actor.auditor },
  { href: '/app/import', label: 'Move in', icon: 'plug', show: actor => actor.owner },
  { href: '/app/business', label: 'Settings', icon: 'gear', show: actor => actor.owner },
]

/** What the frame shows around every page: active people, decisions waiting at Agent work, and the business's clock. */
export interface Shell { people: number; waiting: number; now: number; zone: string }

const headers = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'strict-origin',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; media-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
}

const ROLE_NAMES: Record<string, string> = { author: 'Author', reviewer: 'Reviewer', learner: 'Learner', manager: 'Manager', assessor: 'Assessor' }
const roleLine = (actor: Actor) => actor.owner ? 'Owner' : [...(administrator(actor) ? ['Learning administrator'] : []), ...(Object.keys(actor.grants).length ? ['Custom role'] : []), ...(actor.auditor ? ['Auditor'] : []), ...[...actor.roles].filter(role => role !== 'learner').map(role => ROLE_NAMES[role])].join(', ') || 'Learner'

function rail(actor: Actor, current: string, shell?: Shell): Html {
  // Until the owner names the business every /app page leads to it, so the rail shows only the brand and the person.
  const items = !actor.business ? [] : manager(actor) ? NAV.filter(item => item.show(actor)) : [LEARNING, ...NAV.filter(item => item !== LEARNING && item.show(actor))]
  return h`<nav class="nav" aria-label="${t(actor, 'Main')}"><ul>${items.map(item => {
    const count = shell && item.count ? item.count(shell) : 0
    return h`<li><a href="${item.href}"${item.href === current ? raw(' aria-current="page"') : ''}>${raw(icon(item.icon, { size: 22 }))}<span>${t(actor, item.label)}</span>${count ? h`<span class="count">${count.toLocaleString(actor.locale)}</span>` : ''}</a></li>`
  })}</ul></nav>
<div class="who">${raw(icon('person', { size: 26 }))}<p><strong>${actor.name}</strong><span>${t(actor, roleLine(actor))}</span>${actor.business && shell ? h`<span>${shell.people.toLocaleString(actor.locale)} ${t(actor, 'active people')}</span>` : ''}</p></div>`
}

/** The app frame: the left rail (a menu at phone width), the top bar with the business's date and time and any page
 * tools, and the work surface. `wide` pages lay out their own columns. */
export function page(title: string, actor: Actor | null, body: Html, { current = '', url, status = 200, tools, wide = false, script, locale }: { locale?: Language; current?: string; url?: URL; status?: number; tools?: Html; wide?: boolean; script?: string | string[] } = {}): Response {
  const scripts = [script ?? []].flat()
  const notice = url?.searchParams.get('notice'), error = url?.searchParams.get('error')
  const shell = actor?.shell
  const brand = h`<a class="brand" href="/app"><img src="/brand/mark.svg" alt="" width="30" height="35"><span data-rer-name>${branding.name}</span></a>`
  const clock = shell ? h`<p class="clock"><span>${formatWeekday(shell.now, shell.zone, actor?.locale)}</span><span>${formatClock(shell.now, shell.zone, actor?.locale)}</span></p>` : ''
  const document = h`<!doctype html><html lang="${locale ?? actor?.locale ?? 'en-US'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${branding.name}</title><link rel="icon" href="/brand/mark.svg"><link rel="stylesheet" href="/site/fonts.css"><link rel="stylesheet" href="/site/theme.css"><link rel="stylesheet" href="/beam.css">${scripts.map(src => h`<script src="${src}" defer></script>`)}</head><body>
<div class="app${actor ? '' : ' bare'}">${actor ? h`<input type="checkbox" id="menu-toggle" class="menu-toggle" aria-hidden="true" tabindex="-1"><aside class="rail">${brand}<label for="menu-toggle" class="menu-button">${raw(icon('menu', { size: 22 }))}<span>${t(actor, 'Menu')}</span></label>${rail(actor, current, shell)}</aside>` : h`<aside class="rail">${brand}</aside>`}
<header class="topbar">${clock}${tools ?? ''}</header>
<main class="work${wide ? ' wide' : ''}">${actor?.viewAs ? viewBanner(actor) : ''}${notice ? h`<p class="flash" role="status">${t(actor, notice)}</p>` : ''}${error ? h`<p class="flash error" role="alert">${t(actor, 'That did not work:')} ${t(actor, describeError(error))}</p>` : ''}${body}</main></div></body></html>`
  // A page that needs its own script (the timed quiz's countdown, matching drag-and-drop) may load it from this origin only.
  return new Response(document.html, { status, headers: scripts.length ? { ...headers, 'content-security-policy': headers['content-security-policy'].replace("default-src 'none';", "default-src 'none'; script-src 'self';") } : headers })
}

/** A white card with its heading. */
export function card(heading: string, body: unknown, { id, className = '', level = 2, aside }: { id?: string; className?: string; level?: 2 | 3; aside?: Html } = {}): Html {
  const label = id ? raw(` aria-labelledby="${esc(id)}"`) : ''
  const title = raw(`<h${level} class="card-title"${id ? ` id="${esc(id)}"` : ''}>${esc(heading)}</h${level}>`)
  return h`<section class="card${className ? ` ${className}` : ''}"${label}>${aside ? h`<div class="card-head">${title}${aside}</div>` : title}${body}</section>`
}

/** Rows split by a rule; a row with an href is a link with a chevron. */
export function rows(items: { title: unknown; meta?: unknown; href?: string; aside?: unknown }[]): Html {
  return h`<ul class="rows">${items.map(item => {
    const text = h`<span class="row-text"><span class="row-title">${item.title}</span>${item.meta ? h`<span class="row-meta">${item.meta}</span>` : ''}</span>${item.aside ?? ''}`
    return item.href ? h`<li><a class="row row-link" href="${item.href}">${text}${raw(icon('chevron', { size: 20, className: 'chevron' }))}</a></li>` : h`<li class="row">${text}</li>`
  })}</ul>`
}

/** Lesson progress: a navy fill on a periwinkle track; the words stay in the row's meta text. */
export const progress = (done: number, total: number) => h`<progress class="progress" value="${done}" max="${Math.max(total, 1)}" aria-hidden="true"></progress>`

/** A stacked table cell's label: hidden while the table is a table, the cell's own first line of text at phone width. */
export const cellLabel = (label: string) => h`<span class="cell-label">${label}</span>`

/** A status as a coloured dot and its words: green done, marigold waiting, red-orange overdue. */
export const pill = (status: string, label: string) => h`<span class="status status-${status}"><i class="dot" aria-hidden="true"></i>${label}</span>`

export const backLink = (href: string, label: string) => h`<p class="back"><a href="${href}">${raw(icon('back', { size: 20 }))}<span>${label}</span></a></p>`

/** An agent's self-reported id as a name: "claude-code" reads "Claude Code". */
export const agentName = (id: string) => id.split(/[-_\s]+/).filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ')

export const lessonCount = (done: number, total: number) => `${done} of ${total} ${total === 1 ? 'lesson' : 'lessons'}`

export const count = (value: number) => value.toLocaleString('en-US')
export function bytes(value: number) {
  if (value < 1024) return `${count(value)} bytes`
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024, unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++ }
  return `${size.toLocaleString('en-US', { maximumFractionDigits: size < 10 ? 1 : 0 })} ${units[unit]}`
}


export const hidden = (name: string, value: unknown) => h`<input type="hidden" name="${name}" value="${value}">`

/** ORG-012: whose view this is, read-only, until when, and the way out. */
function viewBanner(actor: Actor) {
  const zone = actor.shell?.zone ?? 'UTC'
  return h`<div class="flash" role="status"><p>Viewing Beam as <strong>${actor.name}</strong>, read-only, until ${formatClock(actor.viewAs!.expiresAt, zone)}: you see their pages as they do, and nothing here changes their training.</p><form method="post" action="/app/view/end"><button type="submit" class="secondary">Exit view</button></form></div>`
}

/** A POST form to the shared action door; returnTo may contain {id} for the created record. */
export function form(action: string, returnTo: string, fields: unknown, submit: string, { multipart = false, secondary = false, className = '' } = {}) {
  return h`<form method="post" action="/app/do/${action}"${className ? h` class="${className}"` : ''}${multipart ? raw(' enctype="multipart/form-data"') : ''}>${hidden('returnTo', returnTo)}${fields}<button type="submit"${secondary ? raw(' class="secondary"') : ''}>${submit}</button></form>`
}

// Several forms share a page, so every control gets its own id.
let sequence = 0
export const uid = (name: string) => `f-${name}-${(sequence = (sequence + 1) % 1_000_000)}`

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

/** Checkboxes under a legend; `scroll` keeps a long list (everyone in the business) to a scrolling box. */
export const checks = (legend: string, name: string, options: { value: string; label: string }[], selected: string[] = [], { scroll = false } = {}) =>
  h`<fieldset${scroll ? raw(' class="scroll-list"') : ''}><legend>${legend}</legend>${options.map(option => h`<label class="check"><input type="checkbox" name="${name}" value="${option.value}"${selected.includes(option.value) ? raw(' checked') : ''}> ${option.label}</label>`)}</fieldset>`

/** Due and event times; pass the business zone as `home` when `zone` is the record's own. */
export const when = (instant: number | null | undefined, zone: string, home = zone, locale = 'en-US') => instant ? formatInstant(instant, zone, home, locale) : '—'

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
