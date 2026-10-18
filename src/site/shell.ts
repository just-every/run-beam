// The run site's frame: one static document per page with the site's tokens (/site/theme.css), its self-hosted faces
// (/site/fonts.css) and compiled stylesheets, the vest favicons and the share image; the header lockup (the vest mark
// and "Beam" in the heading face; Docs and Source) and the footer strip. No script, one origin.
import { h, raw, type Html } from '../beam/ui/html'
import { footer as words } from './landing/copy'
import { run } from './run'

export const licenceUrl = `${run.repository}/blob/main/LICENSE`
const SHARE = 'https://run-beam.com/site/share.jpg'
// A separator or dash never starts a line: the space before it does not break.
const keepSeparators = (html: string) => html.replaceAll(' · ', '\u00a0· ').replaceAll(' – ', '\u00a0– ')

export function siteDocument({ title, description, styles, body, path }: { title: string; description: string; styles: string[]; body: Html; path: string }): string {
  return '<!doctype html>' + h`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><meta name="theme-color" content="#c5d7fd">
<meta property="og:type" content="website"><meta property="og:site_name" content="Beam"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="https://run-beam.com${path === '/' ? '/' : path}"><meta property="og:image" content="${SHARE}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/brand/favicon-32.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/roboto-serif/roboto-serif-display-800.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/inter/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site/fonts.css"><link rel="stylesheet" href="/site/theme.css">${styles.map(href => h`<link rel="stylesheet" href="${href}">`)}</head><body class="site">${raw(keepSeparators(body.html))}</body></html>`.html
}

/** The vest mark and the wordmark. */
export const lockup = (className = 'site-brand') => h`<a class="${className}" href="/"><img src="/brand/mark.svg" alt="" width="28" height="33"><span>Beam</span></a>`

export function siteHeader(current: 'home' | 'docs' = 'home'): Html {
  return h`<header class="site-header"><div class="site-bar">${lockup()}<nav class="site-nav" aria-label="Site"><a href="/docs"${current === 'docs' ? raw(' aria-current="page"') : ''}>Docs</a><a href="${run.repository}">Source</a></nav></div></header>`
}

export function siteFooter(): Html {
  return h`<footer class="site-footer"><div class="site-bar">${lockup()}<p class="site-footer-line">${words.line}</p><nav class="site-nav" aria-label="Footer"><a href="/docs">Docs</a><a href="${run.repository}">Source</a><a href="${licenceUrl}">${words.licence}</a></nav></div></footer>`
}
