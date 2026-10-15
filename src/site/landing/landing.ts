// The run site's homepage, in the approved order: the hero (the differentiator working), 100% free, changes, quizzes,
// records, agent work, also included, moving in, the closing band and the footer.
import { h, raw, type Html } from '../../beam/ui/html'
import { icon } from '../../beam/ui/icons'
import { siteFooter, siteHeader } from '../shell'
import { closing, hero, included, sections } from './copy'
import { agentDrawing, bandSheets, changesDrawing, freeDrawing, heroDrawing, moveInDrawing, quizDrawing, recordsDrawing } from './drawings'

const arrow = raw(icon('arrow', { size: 18 }))
const actions = () => h`<div class="site-actions"><a class="run-button" href="/run">${hero.action} ${arrow}</a><a class="run-button" href="https://demo.run-beam.com/">${hero.demo}</a><a class="docs-link" href="/docs">${hero.docs}</a></div><p class="site-small">${hero.small}</p>`
const alternatives = () => h`<p class="hero-alt">100% free, open source alternative to ${hero.alternatives.map((name, index) => h`${index ? (index === hero.alternatives.length - 1 ? ' and ' : ', ') : ''}<b>${name}</b>`)}</p>`

function feature(id: string, copy: { eyebrow: string; heading: string; body: string }, art: Html, flip = false): Html {
  return h`<section class="feature${flip ? ' flip' : ''}" id="${id}" aria-labelledby="${id}-heading"><div class="feature-text"><p class="eyebrow">${copy.eyebrow}</p><h2 id="${id}-heading">${copy.heading}</h2><p>${copy.body}</p></div><div class="feature-art">${art}</div></section>`
}

export function landing(): Html {
  return h`${siteHeader()}
<main class="landing">
<section class="hero" id="top" aria-labelledby="top-heading"><h1 id="top-heading">${hero.headline}</h1><p class="hero-sub">${hero.subhead}</p>${alternatives()}${actions()}${heroDrawing(hero.drawingLabel)}</section>
${feature('free', sections.free, freeDrawing())}
${feature('changes', sections.changes, changesDrawing(), true)}
${feature('quizzes', sections.quizzes, quizDrawing())}
${feature('records', sections.records, recordsDrawing(), true)}
${feature('agent', sections.agent, agentDrawing())}
<section class="included" id="included" aria-labelledby="included-heading"><p class="eyebrow">${included.eyebrow}</p><h2 id="included-heading">${included.heading}</h2><ul class="tiles">${included.tiles.map(tile => h`<li class="card tile"><span class="disc">${raw(icon(tile.icon))}</span><span class="tile-text"><span class="tile-title">${tile.title}</span><span class="tile-body">${tile.body}</span></span></li>`)}</ul></section>
${feature('move-in', sections.moveIn, moveInDrawing())}
<section class="band" id="start" aria-labelledby="start-heading">${bandSheets()}<div class="band-inner"><h2 id="start-heading">${closing.heading}</h2><p class="band-body">${closing.body}</p>${actions()}</div></section>
</main>
${siteFooter()}`
}
