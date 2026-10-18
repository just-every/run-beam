// The run site (run-beam.com), written by `rer build --site`: the approved landing at /, whose Run Beam opens the Run
// page at /run; the docs at /docs and /docs/<slug>, rendered from docs/*.md; /contract; and the not-found page. Every
// page is static, works without script and links to no instance-only route. The installed Beam serves the Lobby at /.
import { contractPageHtml } from '../base/contract-page'
import { runPageHtml, siteNotFoundHtml, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { docsArticle, docsDescription, docsIndex, docsPages } from './docs/pages'
import { meta } from './landing/copy'
import { landing } from './landing/landing'
import { run } from './run'
import { siteDocument } from './shell'
import './styles/base.css'
import './styles/hero.css'
import './styles/sections.css'
import './styles/docs.css'

// Base's shared pages read the site's tokens and faces and stand on the closing scene's orchard.
const site = { ...identity, theme: '/site/theme.css', fonts: '/site/fonts.css', band: '/site/run-floor.webp' }
// Base's shared pages (src/base, copied unchanged) print British "licence"; Beam is a US product, so they say "license".
const usSpelling = (html: string) => html.replaceAll(`${run.licence} licence<`, `${run.licence} license<`)

export function sitePages({ styles, contract }: SiteContext): SiteBuild {
  return {
    pages: [
      { path: '/', html: siteDocument({ title: meta.title, description: meta.description, styles, body: landing(), path: '/' }) },
      { path: '/run', html: usSpelling(runPageHtml(site, run, contract)) },
      ...(contract ? [{ path: '/contract', html: usSpelling(contractPageHtml(site, run, contract)) }] : []),
      { path: '/docs', html: siteDocument({ title: 'Docs · Beam', description: docsDescription, styles, body: docsIndex(), path: '/docs' }) },
      ...docsPages.map(page => ({ path: `/docs/${page.slug}`, html: siteDocument({ title: `${page.title} · Beam docs`, description: page.summary, styles, body: docsArticle(page.slug), path: `/docs/${page.slug}` }) })),
      { path: '/404', html: usSpelling(siteNotFoundHtml(site, run, contract)) },
    ],
    assets: ['fonts', 'brand', 'site', 'favicon.ico', 'apple-touch-icon.png'],
  }
}
