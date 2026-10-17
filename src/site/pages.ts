// The run site (run-beam.com), written by `rer build --site`: the approved landing at /, whose Run Beam opens the Run
// page at /run; the docs at /docs and /docs/<slug>, rendered from docs/*.md; and the not-found page. Every page is
// static, works without script and links to no instance-only route. The installed Beam serves the Lobby at / instead.
import { contractPageHtml } from '../base/contract-page'
import { runPageHtml, siteNotFoundHtml, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { docsArticle, docsDescription, docsIndex, docsPages } from './docs/pages'
import { meta } from './landing/copy'
import { landing } from './landing/landing'
import { run } from './run'
import { siteDocument } from './shell'
import './site.css'

export function sitePages({ styles, contract }: SiteContext): SiteBuild {
  return {
    pages: [
      { path: '/', html: siteDocument({ title: meta.title, description: identity.tagline, styles, body: landing() }) },
      { path: '/run', html: runPageHtml(identity, run, contract) },
      ...(contract ? [{ path: '/contract', html: contractPageHtml(identity, run, contract) }] : []),
      { path: '/docs', html: siteDocument({ title: 'Docs · Beam', description: docsDescription, styles, body: docsIndex() }) },
      ...docsPages.map(page => ({ path: `/docs/${page.slug}`, html: siteDocument({ title: `${page.title} · Beam docs`, description: page.summary, styles, body: docsArticle(page.slug) }) })),
      { path: '/404', html: siteNotFoundHtml(identity, run, contract) },
    ],
    assets: ['rer-theme.css', 'beam.css', 'fonts', 'brand'],
  }
}
