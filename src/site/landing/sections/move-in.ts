// 11 · 2,406 completions. All carried over: the reviewed TalentLMS import, the CA harassment credit decision and a
// SCORM 1.2 package playing, with the one line that starts Beam on your own computer.
import { h, type Html } from '../../../beam/ui/html'
import { glyph } from '../../icons'
import { sections } from '../copy'
import { disc, lines, section, steps } from '../parts'
import { moveIn, rafael } from '../records'

const check = (label = 'checked') => glyph('check', { size: 20, stroke: 2.6, label })
// The start line and its alternative wrap only between words, keeping the installer's `install.sh | sh` together.
const words = (line: string) => line.split(/(\S*install\.sh \| sh|\S+)/).map(part => {
  const pipe = /^(.*\/)(install\.sh \| sh)$/.exec(part)
  return pipe ? h`<span class="nw">${pipe[1]}</span><wbr><span class="nw">${pipe[2]}</span>` : part.trim() ? h`<span class="nw">${part}</span>` : part
})

export function moveInSection(): Html {
  const copy = sections.moveIn
  const rows: [string, string][] = [['People', `${moveIn.active} active · ${moveIn.former} former`], ['Completions', moveIn.completions], ['Certificate PDFs', moveIn.pdfs], ['Native courses', `${moveIn.drafts} → reviewed drafts`], ['SCORM packages', `${moveIn.scorm12} × 1.2 · ${moveIn.scorm2004} × 2004`], ['Shadow check', `${moveIn.shadow} open = ${moveIn.shadow}`]]
  const art = h`<div class="mi-art">
<article class="card mi-import" aria-label="TalentLMS import, reviewed"><header class="mi-head">${disc('file', 'violet')}<div><p class="mi-title">TalentLMS import · reviewed</p><p class="mi-sub">Export ${moveIn.export} · cutover ${moveIn.cutover}</p></div></header>
<dl class="mi-rows">${rows.map(([key, value]) => h`<div><dt>${key}</dt><dd>${steps(value)} ${check()}</dd></div>`)}</dl>
<div class="mi-credit"><p class="cap">Credit decision · CA harassment</p><p class="mi-credited">${moveIn.credited} credited from TalentLMS history ${check()}</p><p>${moveIn.supervisorsExcluded} supervisors excluded · non-supervisor edition</p><p>${moveIn.oldExcluded} excluded · older than 2 years</p></div></article>
<article class="card mi-scorm" aria-label="A SCORM 1.2 package playing"><header class="mi-head">${disc('file', 'marigold')}<p class="mi-title">cold-room-ppe.zip · SCORM 1.2</p></header>
<dl class="mi-rows mi-rows-tight"><div><dt>${rafael.name} · Thu Oct 22</dt><dd>passed · 92 ${check('passed')}</dd></div><div><dt>Time</dt><dd>18 min</dd></div><div><dt>Resumed</dt><dd>${steps('tablet → phone')} ${check('resumed')}</dd></div></dl></article>
</div>`
  const extra = h`<p class="mi-run">${copy.run}</p><div class="mi-cmd" role="group" aria-label="Start Beam on your computer"><code>${words(copy.command)}</code><code class="mi-alt"># ${words(copy.alternative)}</code></div>`
  return section({ id: 'move-in', tone: 'white', eyebrow: copy.eyebrow, heading: lines(...copy.heading), body: copy.body, layout: 'side', art, extra })
}
