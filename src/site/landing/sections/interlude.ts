// 09 · Interlude, no heading: the Joliet cross-dock from the truck yard, with one HTML tag and its leader line to the
// chock at door 9 (the painted tag was removed from the art).
import { h, raw, type Html } from '../../../beam/ui/html'
import { glyph } from '../../icons'
import { sections } from '../copy'
import { painting } from '../parts'

export function interludeSection(): Html {
  const copy = sections.interlude
  return h`<section class="interlude" aria-label="Door 9 at the Joliet cross-dock"><div class="il-frame">${painting({ name: 'interlude', widths: [768, 1152, 1536], sizes: '100vw', alt: copy.art, width: 1536, height: 1024, className: 'il-art', phone: { name: 'interlude-phone', widths: [400, 700], width: 700, height: 760 } })}
${raw('<svg class="il-lead" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="0" x2="100" y2="100" stroke="#fab60c" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linecap="round"/></svg><span class="il-dot" aria-hidden="true"></span>')}
<p class="il-tag"><span>${copy.tag[0]}</span> <span>${copy.tag[1]} ${glyph('check', { size: 22, stroke: 2.6, label: 'done' })}</span></p></div></section>`
}
