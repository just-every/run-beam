// 12 · Closing: "Ready for the first shift." on the Central Valley sky, over the orchard scene, then the footer strip.
import { h, raw, type Html } from '../../../beam/ui/html'
import { glyph } from '../../icons'
import { closing, hero } from '../copy'
import { painting } from '../parts'

export function closingSection(): Html {
  return h`<section class="closing" id="start" aria-labelledby="start-h"><div class="cl-copy"><h2 id="start-h">${closing.heading}</h2><p class="cl-body">${closing.body}</p><div class="cl-actions"><a class="run-button" href="/run">${hero.action} ${raw(glyph('arrow', { size: 22, stroke: 2.4 }).html)}</a><a class="cl-docs" href="/docs">${hero.docs}</a></div></div>
${painting({ name: 'closing', widths: [768, 1152, 1536], sizes: '100vw', alt: closing.art, width: 1536, height: 644, className: 'cl-art', phone: { name: 'closing-phone', widths: [400, 800], width: 800, height: 584 } })}</section>`
}
