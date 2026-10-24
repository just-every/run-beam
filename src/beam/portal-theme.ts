import { brandImage } from './brand-image'
// ORG-009: presentation never changes authentication origin or cookie authority.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { commit, insist, now, one, stmt } from './core'
import { serve, sniff, store, type Stored } from './files'
import type { Input } from './input'

export interface PortalTheme {
  primary: string; accent: string; signinHeading: string; signinText: string; senderName: string
  logo: Stored | null; favicon: Stored | null; version: number
}
export async function portalTheme(env: Bindings): Promise<PortalTheme | null> {
  const row = await one(env, 'SELECT * FROM beam_portal_theme WHERE singleton=1')
  return row ? { primary: row.primary_color, accent: row.accent_color, signinHeading: row.signin_heading, signinText: row.signin_text, senderName: row.sender_name, logo: JSON.parse(row.logo_json || 'null'), favicon: JSON.parse(row.favicon_json || 'null'), version: row.version } : null
}
export async function themeSettings(env: Bindings, actor: Actor) { requireOwner(actor); return portalTheme(env) }
const luminance = (color: string) => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
function color(input: Input, name: string) {
  const value = input.text(name).toLowerCase()
  insist(/^#[0-9a-f]{6}$/.test(value), 'invalid_theme_color', 400, { field: name })
  const ratio = 1.05 / (luminance(value) + .05)
  insist(ratio >= 4.5, `theme_contrast_${name}`, 400, { pair: `${name} and white`, ratio, minimum: 4.5 })
  return value
}
export async function saveTheme(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const primary = color(input, 'primary'), accent = color(input, 'accent')
  const signinHeading = input.text('signinHeading', { max: 120 }), signinText = input.text('signinText', { max: 500, optional: true }), senderName = input.text('senderName', { max: 100 })
  insist(!/[\r\n<>"\\\x00-\x1f\x7f]/.test(senderName), 'invalid_sender_name')
  const previous = await portalTheme(env)
  const image = async (name: 'logo' | 'favicon') => {
    const file = await input.file(name, { optional: true, maxBytes: 256000 })
    if (!file) return previous?.[name] ?? null
    // Raster images only: an owner upload cannot introduce active SVG or HTML.
    insist(['image/png', 'image/jpeg'].includes(sniff(file.bytes)), 'theme_image_type')
    brandImage(file.bytes)
    return store(env, file)
  }
  const logo = await image('logo'), favicon = await image('favicon')
  await commit(env, [stmt(env, `INSERT INTO beam_portal_theme VALUES(1,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(singleton) DO UPDATE SET primary_color=excluded.primary_color,accent_color=excluded.accent_color,signin_heading=excluded.signin_heading,signin_text=excluded.signin_text,sender_name=excluded.sender_name,logo_json=excluded.logo_json,favicon_json=excluded.favicon_json,version=version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`, primary, accent, signinHeading, signinText, senderName, JSON.stringify(logo), JSON.stringify(favicon), actor.id, now())], { actor, action: 'theme.save', subject: 'employee-portal', detail: { primary, accent } })
  return portalTheme(env)
}

export async function themeAsset(env: Bindings, request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (!['/beam-theme.css', '/beam-theme/logo', '/beam-theme/favicon'].includes(path)) return null
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  const theme = await portalTheme(env)
  if (!theme) return new Response(null, { status: 404 })
  if (path === '/beam-theme.css') return new Response(request.method === 'HEAD' ? null : `html.rer-themed{--rer-accent:${theme.primary};--rer-accent-text:#ffffff;--rer-focus:${theme.accent}}.rer-themed .brand::before{display:none}.portal-logo{width:32px;height:32px;object-fit:contain}button:not(.secondary),.button:not(.secondary){background:${theme.primary};border-color:${theme.primary};color:#ffffff}progress.progress::-webkit-progress-value{background:${theme.accent}}progress.progress::-moz-progress-bar{background:${theme.accent}}:focus-visible{outline-color:${theme.accent}}`, { headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
  const file = path.endsWith('/logo') ? theme.logo : theme.favicon
  if (!file) return new Response(null, { status: 404 })
  const response = await serve(env, file)
  return request.method === 'HEAD' ? new Response(null, response) : response
}

const escape = (value: string) => value.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`)
export async function themeDocument(env: Bindings, response: Response, signin = false): Promise<Response> {
  if (!response.headers.get('content-type')?.includes('text/html')) return response
  const theme = await portalTheme(env)
  if (!theme) return response
  let document = await response.text()
  document = document.replace('</head>', `<link rel="stylesheet" href="/beam-theme.css"></head>`)
  if (theme.favicon) document = document.replace(/<link[^>]+rel="(?:shortcut )?icon"[^>]*>/g, '').replace('</head>', '<link rel="icon" href="/beam-theme/favicon"></head>')
  if (theme.logo) document = document.replace('src="/brand/mark.svg"', 'src="/beam-theme/logo"')
  if (signin && theme.logo) document = document.replace('<p class="brand">', '<p class="brand"><img class="portal-logo" src="/beam-theme/logo" alt="">')
  if (signin) document = document.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/, `<h1>${escape(theme.signinHeading)}</h1><p>${escape(theme.signinText)}</p>`)
  const headers = new Headers(response.headers)
  headers.delete('content-length'); headers.delete('etag'); headers.set('cache-control', 'no-store')
  return new Response(document, { status: response.status, headers })
}

export async function themeMail(env: Bindings, mail: { from: string; html?: string; text?: string; [key: string]: unknown }) {
  const theme = await portalTheme(env)
  if (!theme) return mail
  // Keep the configured, provider-verified mailbox. Only its display name changes.
  const address = mail.from.match(/<([^<>]+)>\s*$/)?.[1] || mail.from
  return { ...mail, from: `${theme.senderName} <${address}>`, html: `<div style="border-top:4px solid ${theme.primary};border-bottom:4px solid ${theme.accent}">${theme.logo ? `<img src="${escape(env.AUTH_ORIGIN)}/beam-theme/logo" alt="" width="80">` : ''}${mail.html || `<p>${escape(mail.text || '')}</p>`}</div>` }
}
