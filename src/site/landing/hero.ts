// The hero: the approved break-room painting on the left under the pale header band, the five cards over its right
// edge, and the promise on the periwinkle ground. All words and cards are HTML at the desk's positions.
import { h, raw, type Html } from '../../beam/ui/html'
import { glyph } from '../icons'
import { lockup } from '../shell'
import { run } from '../run'
import { hero } from './copy'
import { painting, to, type Tint } from './parts'
import { rafael, sync } from './records'

const status = (kind: 'green' | 'grey' | 'check' | 'yellow-check') => kind === 'check'
  ? h`<span class="hc-status">${glyph('check', { size: 16, className: 'gl ck-green', stroke: 2.2, label: 'done' })}</span>`
  : kind === 'yellow-check'
    ? h`<span class="hc-status"><span class="dot d-yellow" role="img" aria-label="exception"></span>${glyph('check', { size: 16, className: 'gl ck-green', stroke: 2.2, label: 'handled' })}</span>`
    : h`<span class="hc-status"><span class="dot d-${kind}" role="img" aria-label="${kind === 'green' ? 'live' : 'scheduled'}"></span></span>`

const smallTick = () => glyph('check', { size: 13, className: 'gl', stroke: 2 })

function card(icon: Parameters<typeof glyph>[0], tint: Tint, title: string, lines: Html[], state: Parameters<typeof status>[0]): Html {
  return h`<li class="hc"><span class="disc t-${tint}">${glyph(icon)}</span><span class="hc-text"><span class="hc-title">${title}</span>${lines}</span>${status(state)}</li>`
}

const cards = () => h`<ul class="hero-cards" aria-label="This morning at Sierra Lakes Produce">
${card('tablet', 'violet', 'Break-room tablet', [h`<span>ID ${rafael.id} + PIN</span>`, h`<span>Español</span>`], 'green')}
${card('people', 'green', 'BambooHR', [h`<span>${rafael.name} joined</span>`, h`<span class="hc-grey">${rafael.role}, ${rafael.site}</span>`, h`<span>4 courses assigned</span>`], 'green')}
${card('doc', 'blue', 'Lift-truck safety', [h`<span class="hc-cond">${sync.lessons} of ${sync.lessons} lessons offline in the cooler</span>`, h`<span>synced ${sync.synced} ${smallTick()}</span>`], 'check')}
${card('person', 'marigold', 'Sam Patel', [h`<span class="hc-cond">no email or phone ${to()} QR sheet printed</span>`, h`<span>signed in ${smallTick()}</span>`], 'yellow-check')}
${card('doc', 'violet', 'IL harassment', [h`<span>52 assigned Mon Nov 2</span>`, h`<span>due Dec 31</span>`], 'grey')}
</ul>`

const alternatives = () => h`<p class="hero-alt">100% free, open source alternative to <span class="nb">${hero.alternatives.map((name, index) => h`${index ? (index === hero.alternatives.length - 1 ? ' and ' : ', ') : ''}<b>${name}</b>`)}</span></p>`

export function heroSection(): Html {
  return h`<section class="hero" id="top" aria-labelledby="top-heading">
<div class="hero-band"><div class="hero-bar">${lockup('site-brand hero-brand')}<nav class="site-nav hero-nav" aria-label="Site"><a href="/docs">Docs</a><a href="${run.repository}">Source</a></nav></div></div>
<div class="hero-stage">
${painting({ name: 'hero', widths: [410, 615, 820], sizes: '(max-width: 1279px) 100vw, 54vw', alt: hero.art, width: 820, height: 964, eager: true, className: 'hero-art', phone: { name: 'hero-phone', widths: [400, 684], width: 684, height: 806, below: 1279 } })}
${cards()}
<div class="hero-copy"><h1 id="top-heading">${hero.headline.map(line => h`<span class="ln">${line}</span> `)}</h1><p class="hero-sub">${hero.subhead}</p>${alternatives()}
<div class="hero-actions"><a class="run-button" href="/run">${hero.action} ${raw(glyph('arrow', { size: 22, stroke: 2.4 }).html)}</a><p class="hero-links"><a href="${hero.demoUrl}">${hero.demo}</a><a href="/docs">${hero.docs}</a></p></div></div>
</div>
</section>`
}
