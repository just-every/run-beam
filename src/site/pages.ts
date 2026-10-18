// The run site (run-beam.com), written by `rer build --site`: the approved landing at /, whose Run Beam opens the Run
// page at /run; the docs at /docs and /docs/<slug>, rendered from docs/*.md; /contract; and the not-found page. Every
// page is static, works without script and links to no instance-only route. The installed Beam serves the Lobby at /.
import { contractPageHtml } from '../base/contract-page'
import { runPageHtml, siteNotFoundHtml, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { docsArticle, docsDescription, docsIndex, docsPages } from './docs/pages'
import { meta } from './landing/copy'
import { landing } from './landing/landing'
import { painting } from './landing/parts'
import { run } from './run'
import { siteDocument } from './shell'
import './styles/base.css'
import './styles/hero.css'
import './styles/sections.css'
import './styles/docs.css'

// Base's shared pages read the site's tokens and faces and stand on the closing scene's horizon: the Sierra Nevada, the
// field stripes, the road and the truck (page-12), with the closing's own phone crop below 761px. Base draws the band as
// one <img> on /run and the not-found page; the build swaps it for the responsive picture and fails if Base's markup
// changes. Base's /contract has no band.
const site = { ...identity, theme: '/site/theme.css', fonts: '/site/fonts.css', band: '/site/run-band-1536.webp' }
const baseBand = '<div class="art" aria-hidden="true"><img src="/site/run-band-1536.webp" alt=""></div>'
const band = `<div class="art" aria-hidden="true">${painting({ name: 'run-band', widths: [768, 1152, 1536], sizes: '100vw', alt: '', width: 1536, height: 540, phone: { name: 'closing-phone', widths: [400, 800], width: 800, height: 584 } }).html}</div>`
function withBand(html: string): string {
  if (html.split(baseBand).length !== 2) throw new Error('Base no longer draws the run site band as one <img>: update src/site/pages.ts')
  return html.replace(baseBand, band)
}
// Base's shared pages (src/base, copied unchanged) print British "licence"; Beam is a US product, so they say "license".
const usSpelling = (html: string) => html.replaceAll(`${run.licence} licence<`, `${run.licence} license<`)

export function sitePages({ styles, contract }: SiteContext): SiteBuild {
  return {
    pages: [
      { path: '/', html: siteDocument({ title: meta.title, description: meta.description, styles, body: landing(), path: '/' }) },
      { path: '/run', html: withBand(usSpelling(runPageHtml(site, run, contract))) },
      ...(contract ? [{ path: '/contract', html: usSpelling(contractPageHtml(site, run, contract)) }] : []),
      { path: '/docs', html: siteDocument({ title: 'Docs · Beam', description: docsDescription, styles, body: docsIndex(), path: '/docs' }) },
      ...docsPages.map(page => ({ path: `/docs/${page.slug}`, html: siteDocument({ title: `${page.title} · Beam docs`, description: page.summary, styles, body: docsArticle(page.slug), path: `/docs/${page.slug}` }) })),
      { path: '/404', html: withBand(usSpelling(siteNotFoundHtml(site, run, contract))) },
    ],
    assets: ['fonts', 'brand', 'site', 'favicon.ico', 'apple-touch-icon.png'],
  }
}
