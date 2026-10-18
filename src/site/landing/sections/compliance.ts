// 10 · California and Illinois, on one page: the six-requirement report for 131 people with its state pills, the CA
// supervisor session on Zoom and the next renewal. At phone width each requirement is a block.
import { h, type Html } from '../../../beam/ui/html'
import { glyph } from '../../icons'
import { sections } from '../copy'
import { disc, lines, section } from '../parts'
import { company, practical, requirements } from '../records'

const check = (label = 'done') => glyph('check', { size: 18, stroke: 2.6, label })

function report(): Html {
  return h`<article class="card cp-report" aria-label="Requirements report"><header class="cp-head"><div><p class="cp-title">Requirements · ${company.people} people</p><p class="cp-asof">as of Mon Nov 2</p></div><div class="cp-right"><p class="pill p-green cp-zero">0 overdue ${check()}</p><ul class="cp-filters" aria-label="Filter"><li class="on">All ${company.people}</li><li>CA ${company.ca}</li><li>IL ${company.il}</li></ul></div></header>
<table class="cp-table"><thead><tr><th scope="col">Requirement</th><th scope="col">Required</th><th scope="col">Current</th><th scope="col">Open</th><th scope="col">Overdue</th></tr></thead>
<tbody>${requirements.map(row => h`<tr><th scope="row"><span class="cp-name">${row.name}</span>${'note' in row ? h`<span class="cp-note">${row.note}</span>` : ''}</th><td data-label="Required">${row.required}</td><td data-label="Current"><span class="cp-of">${row.current}<span class="cp-ofs"> of ${row.required}</span></span></td><td data-label="Open">${row.open}</td><td data-label="Overdue" class="cp-over">0</td></tr>`)}</tbody></table></article>`
}

const zoom = () => h`<article class="card cp-side cp-zoom" aria-label="Live session on Zoom"><header class="cp-side-head">${disc('calendarGrid', 'blue')}<div><p class="cp-side-title">Live on Zoom · Thu Oct 29</p><p class="cp-side-sub">CA supervisor harassment prevention · 9:00–11:00 am PT</p></div></header>
<dl class="cp-kv"><div><dt>Attended 2:00</dt><dd>7 ${check()}</dd></div><div><dt>Left at 0:47</dt><dd>1</dd></div><div><dt>On leave</dt><dd>1</dd></div></dl><p class="note-green">2 rebooked Thu Nov 5 ${check()}</p></article>`

const renewals = () => h`<article class="card cp-side cp-renew" aria-label="Renewals coming up"><header class="cp-side-head">${disc('sync', 'marigold')}<p class="cp-side-title">Renewals coming up</p></header>
<dl class="cp-kv cp-kv-wide"><div><dt>Juan Morales · lift-truck</dt><dd>expires Sat Nov 28</dd></div><div><dt>Practical booked</dt><dd>Tue Nov 10 · ${practical.assessor}</dd></div></dl><p class="cp-assigned">Assigned Wed Oct 28 · 31 days ahead</p></article>`

export function complianceSection(): Html {
  const copy = sections.compliance
  return section({ id: 'compliance', tone: 'pale', eyebrow: copy.eyebrow, heading: lines(...copy.heading), body: copy.body, layout: 'stack', art: h`<div class="cp-art">${report()}<div class="cp-col">${zoom()}${renewals()}</div></div>` })
}
