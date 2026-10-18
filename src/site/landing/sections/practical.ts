// 05 · Watched on the floor, not just clicked: Maria Chen's observed practical, certificate SLP-0418 and the BambooHR
// training record written back, joined by the two hand-drawn yellow arrows.
import { h, raw, type Html } from '../../../beam/ui/html'
import { glyph } from '../../icons'
import { sections } from '../copy'
import { disc, done, pill, section } from '../parts'
import { practical, rafael } from '../records'

const steps = ['Pre-shift inspection', 'Load within rated capacity', 'Forks low while traveling', 'Stop and horn at cooler doors', 'Yield to pedestrians', 'Ramp: load uphill', 'Park, forks down, key out', 'Battery and charger area']
const rows = (pairs: [string, string][]) => h`<dl class="kv">${pairs.map(([key, value]) => h`<div><dt>${key}</dt><dd>${value}</dd></div>`)}</dl>`
const curl = (className: string) => raw(`<svg class="curl ${className}" viewBox="0 0 90 60" aria-hidden="true"><path d="M3 10C38 4 66 16 78 46" fill="none" stroke="#fab60c" stroke-width="3.2" stroke-linecap="round"/><path d="m68 40 10 9 4-13" fill="none" stroke="#fab60c" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`)

export function practicalSection(): Html {
  const copy = sections.practical
  const art = h`<div class="practical-art">
<article class="card pr-card pr-check" aria-label="Observed practical"><header class="pr-head">${disc('forklift', 'violet')}<div><p class="cap">Observed practical</p><p class="pr-title">Forklift · sit-down counterbalance</p><p class="pr-sub">${rafael.name} · assessor ${practical.assessor}</p></div></header>
<ul class="pr-steps">${steps.map(step => h`<li>${done()}<span>${step}</span></li>`)}</ul><footer class="pr-foot"><span>${practical.items} of ${practical.items} · passed ${practical.passed}</span>${pill('Passed', 'green')}</footer></article>
${curl('c1')}
<article class="card pr-card pr-cert" aria-label="Certificate"><header class="pr-head">${disc('fileBadge', 'green')}<div><p class="cap">Certificate</p><p class="pr-big">No. ${practical.certificate}</p></div></header>${rows([['Issued by', 'Sierra Lakes Produce'], ['Course', 'Lift-truck safety · rev 4'], ['Completed', practical.completed], ['Renews', practical.renews]])}<footer class="pr-foot pr-quiet">Evaluation every 3 years</footer></article>
${curl('c2')}
<article class="card pr-card pr-hris" aria-label="BambooHR training record"><header class="pr-head">${disc('fileCheck', 'blue')}<div><p class="cap">BambooHR · Training record</p><p class="pr-mid">Written back ${practical.written} ${glyph('check', { size: 22, stroke: 2.6, label: 'done' })}</p></div></header>${rows([['Employee', `${rafael.name} · ${rafael.id}`], ['Type', 'Forklift operator evaluation'], ['Hours', practical.hours], ['Certificate', practical.certificate]])}<p class="note-green">${practical.writtenBack} completions written back since Sep 29 · 0 errors</p></article>
</div>`
  return section({ id: 'practical', tone: 'white', eyebrow: copy.eyebrow, heading: copy.heading, body: copy.body, layout: 'stack', art })
}
