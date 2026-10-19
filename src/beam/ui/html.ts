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
  { href: '/app/announcements', label: 'Announcements', icon: 'bell', show: actor => manager(actor) || administrator(actor) },
  { href: '/app/reports', label: 'Reports', icon: 'chart', show: actor => manager(actor) || administrator(actor) || !!actor.grants.reports },
  LEARNING,
  { href: '/app/catalog', label: 'Catalog', icon: 'book', show: () => true },
  { href: '/app/sessions', label: 'Sessions', icon: 'calendar', show: () => true },
  { href: '/app/recognition', label: 'Recognition', icon: 'rosette', show: actor => !!actor.business },
  { href: '/app/external', label: 'Certificates', icon: 'clipboard', show: actor => !!actor.business },
  { href: '/app/evidence', label: 'Shared evidence', icon: 'document', show: actor => actor.auditor },
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
  return h`<nav class="nav" aria-label="Main"><ul>${items.map(item => {
    const count = shell && item.count ? item.count(shell) : 0
    return h`<li><a href="${item.href}"${item.href === current ? raw(' aria-current="page"') : ''}>${raw(icon(item.icon, { size: 22 }))}<span>${item.label}</span>${count ? h`<span class="count">${count.toLocaleString('en-US')}</span>` : ''}</a></li>`
  })}</ul></nav>
<div class="who">${raw(icon('person', { size: 26 }))}<p><strong>${actor.name}</strong><span>${roleLine(actor)}</span>${actor.business && shell ? h`<span>${shell.people.toLocaleString('en-US')} active</span>` : ''}</p></div>`
}

/** The app frame: the left rail (a menu at phone width), the top bar with the business's date and time and any page
 * tools, and the work surface. `wide` pages lay out their own columns. */
export function page(title: string, actor: Actor | null, body: Html, { current = '', url, status = 200, tools, wide = false, script }: { current?: string; url?: URL; status?: number; tools?: Html; wide?: boolean; script?: string | string[] } = {}): Response {
  const scripts = [script ?? []].flat()
  const notice = url?.searchParams.get('notice'), error = url?.searchParams.get('error')
  const shell = actor?.shell
  const brand = h`<a class="brand" href="/app"><img src="/brand/mark.svg" alt="" width="30" height="35"><span data-rer-name>${branding.name}</span></a>`
  const clock = shell ? h`<p class="clock"><span>${formatWeekday(shell.now, shell.zone)}</span><span>${formatClock(shell.now, shell.zone)}</span></p>` : ''
  const document = h`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${branding.name}</title><link rel="icon" href="/brand/mark.svg"><link rel="stylesheet" href="/site/fonts.css"><link rel="stylesheet" href="/site/theme.css"><link rel="stylesheet" href="/beam.css">${scripts.map(src => h`<script src="${src}" defer></script>`)}</head><body>
<div class="app${actor ? '' : ' bare'}">${actor ? h`<input type="checkbox" id="menu-toggle" class="menu-toggle" aria-hidden="true" tabindex="-1"><aside class="rail">${brand}<label for="menu-toggle" class="menu-button">${raw(icon('menu', { size: 22 }))}<span>Menu</span></label>${rail(actor, current, shell)}</aside>` : h`<aside class="rail">${brand}</aside>`}
<header class="topbar">${clock}${tools ?? ''}</header>
<main class="work${wide ? ' wide' : ''}">${actor?.viewAs ? viewBanner(actor) : ''}${notice ? h`<p class="flash" role="status">${notice}</p>` : ''}${error ? h`<p class="flash error" role="alert">That did not work: ${describeError(error)}</p>` : ''}${body}</main></div></body></html>`
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

const ERRORS: Record<string, string> = {
  stale_draft: 'someone else saved this draft first. Reload and apply your change again.',
  exemption_not_allowed: 'the owner’s exception policy lets managers defer this, not exempt it. Ask a learning administrator or the owner.',
  exception_too_long: 'that end date is longer than the exception policy allows.',
  exception_ends_in_past: 'the end date has already passed.',
  exception_active: 'an exception already holds this assignment until its end date.',
  blocker_already_reported: 'a blocker is already waiting for a decision on this assignment.',
  backdated_completion: 'this attendance is dated before the due date of an assignment that was already overdue, so it cannot close it. Cancel that assignment with a reason first, then record the attendance.',
  proposal_stale: 'what this proposal was prepared from changed after it was prepared, so it cannot be applied as is.',
  lessons_incomplete: 'finish every lesson first.',
  prerequisite_incomplete: 'the prerequisite course must be completed first.',
  session_in_past: 'the first meeting must be in the future.',
  session_started: 'this session has already started; choose another one.',
  session_cancelled: 'this session was cancelled.',
  session_not_offered: 'you can choose a session only of a course assigned to you.',
  not_an_instructor: 'that person has no instructor access for this course. Grant it under Instructors on People first.',
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
  completed_assignment_not_reset: 'a completed assignment is never reset; its completion stays with its revision. Assign the course again instead.',
  learner_outside_your_team: 'you can do this only for people in one of your teams.',
  attempt_closed_by_reset: 'this attempt was closed when the assignment was reset.',
  access_not_open: 'this course is not open yet. It opens on the date shown on the course.',
  access_ended: 'access to this course has ended. Your records and certificates stay readable; your manager can extend access.',
  no_access_window: 'this assignment has no access window to extend.',
  time_expired: 'the time limit has passed. Only the answers saved before it were scored.',
  quiz_not_started: 'start the timed quiz first.',
  quiz_not_timed: 'this quiz has no time limit.',
  window_closes_before_it_opens: 'the closing date must be on or after the opening date.',
  outside_your_units: 'this is outside the business units you administer.',
  owner_required: 'only the owner can do this.',
  grant_exists: 'this person already administers that unit.',
  expiry_in_past: 'the end date must be in the future.',
}
export const describeError = (code: string) => ERRORS[code] ?? code.replace(/_/g, ' ') + '.'

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
