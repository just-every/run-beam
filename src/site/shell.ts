// The run site's frame: one document with Beam's own tokens and components (/rer-theme.css, /beam.css) plus the site's
// compiled stylesheet, the header (mark and Beam; Docs, Contract and Source) and the footer. Static, no script, one origin.
import { h, raw, type Html } from '../beam/ui/html'
import { footer as words } from './landing/copy'
import { run } from './run'

export const licenceUrl = `${run.repository}/blob/main/LICENSE`

export function siteDocument({ title, description, styles, body }: { title: string; description: string; styles: string[]; body: Html }): string {
  return '<!doctype html>' + h`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><meta name="theme-color" content="#fbfaf7"><link rel="icon" href="/brand/mark.svg"><link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/rer-theme.css"><link rel="stylesheet" href="/beam.css">${styles.map(href => h`<link rel="stylesheet" href="${href}">`)}</head><body class="site">${body}</body></html>`.html
}

const brand = () => h`<a class="site-brand" href="/"><img src="/brand/mark.svg" alt="" width="30" height="30"><span>Beam</span></a>`

export function siteHeader(current: 'home' | 'docs' = 'home'): Html {
  return h`<header class="site-header"><div class="site-bar">${brand()}<nav class="site-nav" aria-label="Site"><a href="/docs"${current === 'docs' ? raw(' aria-current="page"') : ''}>Docs</a><a href="/contract">Contract</a><a href="${run.repository}">Source</a></nav></div></header>`
}

export function siteFooter(): Html {
  return h`<footer class="site-footer"><div class="site-bar">${brand()}<p class="site-footer-line">${words.line}</p><nav class="site-nav" aria-label="Footer"><a href="/docs">Docs</a><a href="${run.repository}">Source</a><a href="${licenceUrl}">${words.licence}</a></nav></div></footer>`
}
