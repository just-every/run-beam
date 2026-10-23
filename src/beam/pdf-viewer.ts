// Only the trusted shell is HTML. Original PDF bytes remain inert data inside
// an opaque, script-enabled sandbox; the browser never receives a source URL.
import pdfjsSource from 'unpdf/pdfjs?raw'
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { insist } from './core'
import { sourceFile } from './sources'
import { esc } from './ui/html'
import { pdfViewerClient } from './pdf-viewer-client'

export const PDF_LIBRARY_PATH = '/app/pdf-library.mjs'
export const PDF_BOOTSTRAP_PATH = '/app/pdf-viewer-client.mjs'
export const PDF_VIEWER_SUFFIX = '/pdf-preview'
const MAX_BYTES = 10_000_000

function scriptResponse(source: string): Response {
  return new Response(source, { headers: {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
    'x-content-type-options': 'nosniff',
  } })
}
/** Public application code only. Opaque frames load modules without cookies. */
export const pdfLibraryResponse = () => scriptResponse(pdfjsSource)
export const pdfViewerBootstrapResponse = () => scriptResponse(pdfViewerClient)

function base64(bytes: Uint8Array): string {
  const chunks: string[] = []
  // Chunk sizes are divisible by three, so only the final chunk has padding.
  for (let offset = 0; offset < bytes.length; offset += 24_576) chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576))))
  return chunks.join('')
}

export async function pdfViewerResponse(env: Bindings, actor: Actor, sourceVersion: string, origin: string): Promise<Response> {
  const trusted = new URL(origin)
  insist(origin === env.AUTH_ORIGIN && trusted.origin === origin && ['https:', 'http:'].includes(trusted.protocol), 'invalid_pdf_viewer_origin', 500)
  // This existing door authorizes staff/cited learners, enforces current access
  // windows and erasure, and checks the immutable original's digest and size.
  const original = await sourceFile(env, actor, sourceVersion, false)
  insist(original.headers.get('content-type') === 'application/pdf', 'source_not_pdf', 422)
  const bytes = new Uint8Array(await original.arrayBuffer())
  insist(bytes.length > 0 && bytes.length <= MAX_BYTES, 'document_pdf_size', 422)
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const library = `${origin}${PDF_LIBRARY_PATH}`, bootstrap = `${origin}${PDF_BOOTSTRAP_PATH}`
  const stylesheet = `${origin}/beam-pdf.css`, theme = `${origin}/site/theme.css`
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PDF document</title><link rel="stylesheet" href="${esc(theme)}"><link rel="stylesheet" href="${esc(stylesheet)}"><script type="module" nonce="${nonce}" src="${esc(bootstrap)}"></script></head><body>
<main aria-label="PDF document"><nav aria-label="PDF pages and zoom"><button id="pdf-previous" type="button" disabled>Previous page</button><span id="pdf-position">Page —</span><button id="pdf-next" type="button" disabled>Next page</button><label for="pdf-zoom">Zoom</label><select id="pdf-zoom" disabled><option value="fit">Fit width</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select></nav>
<p id="pdf-status" role="status" aria-live="polite">Opening original PDF…</p><div id="pdf-stage" aria-busy="true"><canvas id="pdf-canvas" role="img" aria-label="PDF page" hidden></canvas></div><details><summary>Page text</summary><div id="pdf-page-text"></div></details><noscript>Enable JavaScript to read this protected preview, or download the original from the lesson.</noscript></main>
<script id="pdf-data" type="application/octet-stream">${base64(bytes)}</script></body></html>`
  return new Response(html, { headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex, nofollow',
    'content-security-policy': `sandbox allow-scripts; default-src 'none'; script-src 'nonce-${nonce}' ${library} ${bootstrap}; style-src ${stylesheet} ${theme}; img-src blob: data:; font-src 'none'; connect-src 'none'; worker-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`,
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  } })
}
