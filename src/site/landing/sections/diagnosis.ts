// 07 · Three near-misses. One unclear step. The navy band: the agent's diagnosis of DP-7, a process gap and not a
// training gap, with the retraining it did not propose struck through and the site lead's approval.
import { h, type Html } from '../../../beam/ui/html'
import { glyph } from '../../icons'
import { sections } from '../copy'
import { disc, lines, section } from '../parts'
import { dp7 } from '../records'

export function diagnosisSection(): Html {
  const copy = sections.diagnosis
  const art = h`<article class="card dx" aria-label="Diagnosis of DP-7, the dock door procedure">
<p class="dx-title">Diagnosis · DP-7 Dock door procedure</p><p class="dx-sub">Prepared Wed Oct 14 · 5 sources cited</p>
<ul class="dx-rows"><li>${disc('doc', 'blue')}<div><p>Safety log</p><span>3 near-misses: door 8 Tue Oct 6, door 7 Fri Oct 9, door 9 Mon Oct 12</span></div></li>
<li>${disc('peopleCheck', 'violet')}<div><p>Training</p><span>All 3 drivers completed rev 5 · quiz avg 94%</span></div></li>
<li>${disc('question', 'yellow')}<div><p>Questions</p><span>4 of ${dp7.staff} asked: chocks or leveler first?</span></div></li></ul>
<p class="dx-step"><span>Step 4 · Lower the leveler <u>and chock</u> the trailer.</span></p>
<div class="dx-verdicts"><div class="dx-yes"><span class="okc big" role="img" aria-label="proposed">${glyph('check', { size: 22, stroke: 2.8 })}</span><div><p>Process gap: step 4 order is unclear</p><span>Rewrite step 4 · update lesson 3 and quiz Q5</span></div></div>
<div class="dx-no"><span class="noc" role="img" aria-label="not proposed">${glyph('cross', { size: 20, stroke: 2.8 })}</span><div><p><s>Retrain all ${dp7.staff} on DP-7</s></p><span>Not proposed: they passed it</span></div></div></div>
<footer class="dx-foot"><span>Reviewer: Keisha Grant, Joliet site lead</span><span class="dx-approved">Approved ${dp7.approved}</span></footer></article>`
  return section({ id: 'diagnosis', tone: 'navy', eyebrow: copy.eyebrow, heading: lines(...copy.heading), body: copy.body, layout: 'side', art })
}
