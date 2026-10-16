import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Marked } from 'marked'

// The docs, read from docs/site.json and docs/*.md and rendered to HTML when the run site builds; no browser or Worker
// ever parses Markdown. Raw HTML in the Markdown is shown as text. A link to a missing page or heading, a level-1
// heading, an image, a code block without a language or a build machine's path fails the build, listing every problem.

export interface DocsPage { slug: string; title: string; file: string; summary: string }
export interface DocsSection { title: string; pages: DocsPage[] }
export interface DocsBody { html: string; toc: { depth: number; id: string; text: string }[] }
export interface DocsSite { sections: DocsSection[]; bodies: Record<string, DocsBody>; files: string[] }

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
// Rendered inline HTML to plain text: drop everything from each "<" to its ">" (no regex, so removal cannot join the
// remainder into a new tag), then decode each entity once, so "&amp;lt;" becomes "&lt;" and not "<".
const text = (html: string) => html.split('<').map((part, index) => index ? part.slice(part.indexOf('>') + 1) : part).join('').replace(/&(?:amp|lt|gt|quot|#39);/g, entity => entities[entity]).replace(/\s+/g, ' ').trim()
const slugOf = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-')
const machinePath = /(?<![\w.@~-])\/(?:Users|home|private|tmp|var|Volumes|root)\/[^\s"'`<\\]*/g

function render(markdown: string) {
  const toc: DocsBody['toc'] = [], ids: string[] = [], links: string[] = [], problems: string[] = []
  const seen = new Map<string, number>()
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        if (depth === 1) problems.push('has a level-1 heading; the page title comes from docs/site.json')
        const inner = this.parser.parseInline(tokens), base = slugOf(text(inner)), count = seen.get(base) ?? 0
        seen.set(base, count + 1)
        const id = count ? `${base}-${count}` : base
        ids.push(id)
        if (depth === 2 || depth === 3) toc.push({ depth, id, text: text(inner) })
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`
      },
      code({ text: code, lang }) {
        if (!lang) problems.push('has a code block without a language')
        return `<pre class="docs-code"><code>${escape(code.replace(/\n$/, ''))}</code></pre>\n`
      },
      html({ text: raw }) { return escape(raw) },
      link({ href, tokens }) { links.push(href); return `<a href="${escape(href)}">${this.parser.parseInline(tokens)}</a>` },
      image({ href }) { problems.push(`has an image (${href}); the docs publish text only`); return '' },
      table(token) {
        const head = token.header.map(cell => `<th scope="col">${this.parser.parseInline(cell.tokens)}</th>`).join('')
        const rows = token.rows.map(row => `<tr>${row.map(cell => `<td>${this.parser.parseInline(cell.tokens)}</td>`).join('')}</tr>`).join('')
        return `<div class="docs-table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`
      },
    },
  })
  return { html: marked.parse(markdown, { async: false }) as string, toc, ids, links, problems }
}

export function buildDocs(root: string): DocsSite {
  const manifest = join(root, 'docs/site.json')
  const sections = (JSON.parse(readFileSync(manifest, 'utf8')) as { sections: DocsSection[] }).sections
  const pages = sections.flatMap(section => section.pages)
  const files = [manifest]
  const rendered = new Map(pages.map(page => { const file = join(root, 'docs', page.file); files.push(file); return [page.slug, render(readFileSync(file, 'utf8'))] as const }))
  const problems: string[] = []
  for (const page of pages) {
    const own = rendered.get(page.slug)!, report = (problem: string) => problems.push(`docs/${page.file}: ${problem}`)
    own.problems.forEach(report)
    for (const href of own.links) {
      if (/^(?:https?:|mailto:)/i.test(href)) continue
      const local = /^\/docs(?:\/([^#?/]+))?\/?(?:#(.+))?$/.exec(href), inPage = /^#(.+)$/.exec(href)
      if (inPage) { if (!own.ids.includes(inPage[1])) report(`links to ${href}, which is not a heading on this page`) }
      else if (href === '/run') continue
      else if (!local) report(`links to ${href}; link to other pages as /docs/<slug>, or use a full https:// address`)
      else if (local[1] && !rendered.has(local[1])) report(`links to ${href}, but docs/site.json has no page "${local[1]}"`)
      else if (local[2] && !(local[1] ? rendered.get(local[1])!.ids : []).includes(local[2])) report(`links to ${href}, which is not a heading on that page`)
    }
    for (const leak of new Set(own.html.match(machinePath) ?? [])) report(`contains ${leak}, a build machine path`)
  }
  if (problems.length) throw new Error(`Docs: ${problems.length} problem(s) in the Markdown:\n- ${problems.join('\n- ')}`)
  return { sections, bodies: Object.fromEntries(pages.map(page => [page.slug, { html: rendered.get(page.slug)!.html, toc: rendered.get(page.slug)!.toc }])), files }
}
