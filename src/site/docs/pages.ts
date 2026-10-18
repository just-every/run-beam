// The docs on the run site, in the landing's look: an index of every guide by section, and one page per guide with the
// section list beside it, its contents, and the previous and next guide.
import { bodies, sections } from 'virtual:beam-docs'
import { h, raw, type Html } from '../../beam/ui/html'
import { glyph } from '../icons'
import { siteFooter, siteHeader } from '../shell'

export const docsPages = sections.flatMap(section => section.pages)
export const docsDescription = 'Guides for running Beam: getting started, courses, assignments, learning, agent work, moving in, and backup and restore.'

function sidebar(current?: string): Html {
  return h`<nav class="docs-nav" aria-label="Docs"><p class="docs-nav-home"><a href="/docs"${current ? '' : raw(' aria-current="page"')}>All guides</a></p>${sections.map(section => h`<p class="docs-nav-title">${section.title}</p><ul>${section.pages.map(page => h`<li><a href="/docs/${page.slug}"${page.slug === current ? raw(' aria-current="page"') : ''}>${page.title}</a></li>`)}</ul>`)}</nav>`
}

export function docsIndex(): Html {
  return h`${siteHeader('docs')}<main class="docs"><div class="docs-layout">${sidebar()}<div class="docs-main"><p class="eyebrow">Docs</p><h1>Beam docs</h1><p class="docs-lede">Everything you need to run Beam for your own team: from the first <code>rer dev</code> to moving in, backups and agent work.</p>
${sections.map(section => h`<section class="docs-section" aria-label="${section.title}"><h2>${section.title}</h2><ul class="docs-cards">${section.pages.map(page => h`<li><a class="card docs-card" href="/docs/${page.slug}"><span class="docs-card-title">${page.title}</span><span class="docs-card-body">${page.summary}</span><span class="docs-card-go">${glyph('arrow', { size: 16, stroke: 2.4 })}</span></a></li>`)}</ul></section>`)}</div></div></main>${siteFooter()}`
}

export function docsArticle(slug: string): Html {
  const index = docsPages.findIndex(page => page.slug === slug), page = docsPages[index], body = bodies[slug]
  const previous = docsPages[index - 1], next = docsPages[index + 1]
  const section = sections.find(candidate => candidate.pages.some(item => item.slug === slug))!
  return h`${siteHeader('docs')}<main class="docs"><div class="docs-layout">${sidebar(slug)}<article class="docs-main docs-article"><p class="eyebrow">${section.title}</p><h1>${page.title}</h1><p class="docs-lede">${page.summary}</p>
${body.toc.length > 2 ? h`<nav class="docs-toc" aria-label="On this page"><p>On this page</p><ul>${body.toc.filter(entry => entry.depth === 2).map(entry => h`<li><a href="#${entry.id}">${entry.text}</a></li>`)}</ul></nav>` : ''}
<div class="docs-body">${raw(body.html)}</div>
<nav class="docs-pager" aria-label="Previous and next">${previous ? h`<a class="docs-prev" href="/docs/${previous.slug}"><span>Previous</span>${previous.title}</a>` : h`<span></span>`}${next ? h`<a class="docs-next" href="/docs/${next.slug}"><span>Next</span>${next.title}</a>` : ''}</nav></article></div></main>${siteFooter()}`
}
