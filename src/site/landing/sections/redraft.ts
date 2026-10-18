// 08 · Redrafted only where it changed: lesson 3's step 4 diff in English and Spanish, the ten-lesson strip with only
// lesson 3 changed, and the rollout to all 38 dock staff with progress kept.
import { h, type Html } from '../../../beam/ui/html'
import { glyph } from '../../icons'
import { sections } from '../copy'
import { pill, section, steps } from '../parts'
import { dp7 } from '../records'

const tick = (label = 'done') => glyph('check', { size: 18, stroke: 2.8, label })

export function redraftSection(): Html {
  const copy = sections.redraft
  const art = h`<div class="rd-art">
<div class="rd-left"><article class="card rd-diff" aria-label="Lesson 3, Securing the trailer, rev 5 to rev 6"><header class="rd-head"><p class="rd-title">Lesson 3 · Securing the trailer</p><span class="rd-revs">${pill('rev 5', 'grey')}${pill('rev 6', 'yellow')}</span></header>
<p class="rd-line rd-del"><span class="rd-mark" role="img" aria-label="removed">${glyph('minus', { size: 16, stroke: 3 })}</span><del>4. Lower the leveler and chock the trailer.</del></p>
<p class="rd-line rd-add"><span class="rd-mark" role="img" aria-label="added">${glyph('check', { size: 16, stroke: 3 })}</span><span>4. Chock both wheels first. Then lower the leveler.</span></p>
<p class="rd-line rd-add" lang="es"><span class="rd-mark" role="img" aria-label="added">${glyph('check', { size: 16, stroke: 3 })}</span><span>4. Calce ambas ruedas primero. Luego baje la rampa.</span></p>
<p class="rd-foot">Quiz Q5 updated · Español reviewed by Carmen Díaz</p></article>
<div class="rd-strip"><p class="rd-strip-title">Lessons</p><ol class="rd-lessons">${Array.from({ length: 10 }, (_, index) => index + 1).map(n => n === 3 ? h`<li class="changed"><b>3</b><span>changed</span></li>` : h`<li><b>${n}</b>${tick('unchanged')}</li>`)}</ol><p class="rd-unchanged">9 lessons unchanged</p></div></div>
<article class="card rd-roll" aria-label="Rollout to ${dp7.staff} dock staff"><p class="rd-title">Rollout · ${dp7.staff} dock staff</p>
<dl class="rd-nums"><div><dt>${dp7.finished}</dt><dd>${steps('finished rev 5 → assigned lesson 3 + Q5')}</dd></div><div><dt>${dp7.midCourse}</dt><dd>${steps('mid-course → moved to rev 6, progress kept')}</dd></div><div><dt>0</dt><dd>full retakes</dd></div></dl>
<div class="rd-bar" role="img" aria-label="${dp7.staff} of ${dp7.staff} done"><span></span></div>
<p class="rd-done">${dp7.staff} of ${dp7.staff} done ${dp7.done} ${tick()}</p><p class="rd-meta">avg 9 min · English ${dp7.english} · Español ${dp7.spanish}</p>
<p class="note-blue">Near-misses at doors 7–9 since rev 6: 0 so far · measuring to ${dp7.measuring}</p></article>
</div>`
  return section({ id: 'redraft', tone: 'white', eyebrow: copy.eyebrow, heading: copy.heading, body: copy.body, layout: 'stack', art })
}
