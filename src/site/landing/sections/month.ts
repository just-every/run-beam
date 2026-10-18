// 02 · One month at Sierra Lakes Produce: Beam's own two-lane shift calendar, six week columns on one grid, Rafael's
// hire, the DP-7 procedure and Tomás Vega's overdue follow-up in its own slim row, its chip spanning Oct 19 and Oct 26
// in two lines. Below 1280 it is an agenda.
import { h, type Html } from '../../../beam/ui/html'
import { glyph } from '../../icons'
import { sections } from '../copy'
import { section, to } from '../parts'
import { company, dp7, rafael } from '../records'

type Chip = { text: string; done?: boolean; warn?: boolean }
const chip = ({ text, done, warn }: Chip) => h`<li class="mc${warn ? ' mc-warn' : ''}">${warn ? glyph('warning', { size: 16, className: 'gl mc-tri', stroke: 2, label: 'near-miss' }) : ''}<span>${text}</span>${done ? glyph('check', { size: 16, className: 'gl mc-ok', stroke: 2.6, label: 'done' }) : ''}</li>`

const weeks = [
  { label: 'Week of Sep 28', short: 'Sep 28', marker: { text: 'Tue 29 · off TalentLMS', tone: 'blue' } },
  { label: 'Oct 5', short: 'Oct 5' },
  { label: 'Oct 12', short: 'Oct 12' },
  { label: 'Oct 19', short: 'Oct 19' },
  { label: 'Oct 26', short: 'Oct 26' },
  { label: 'Nov 2', short: 'Nov 2', marker: { text: 'Mon 2 · Illinois cycle', tone: 'green', done: true } },
] as const

const hire: Chip[][] = [[], [], [{ text: 'Fri 16 · hired in BambooHR' }], [{ text: 'Mon 19 · first shift, Español' }, { text: 'Tue 20 · forklift practical', done: true }, { text: 'Thu 22 · cold room SCORM', done: true }], [{ text: 'Fri 30 · ammonia', done: true }], []]
const procedure: Chip[][] = [[], [{ text: 'Tue 6 · near-miss, door 8', warn: true }, { text: 'Fri 9 · near-miss, door 7', warn: true }], [{ text: 'Mon 12 · near-miss, door 9', warn: true }, { text: 'Wed 14 · agent diagnosis' }], [{ text: 'Mon 19 · approved' }, { text: 'Tue 20 · rev 6 live' }, { text: `Fri 23 · ${dp7.staff} of ${dp7.staff}`, done: true }], [{ text: '0 near-misses since rev 6' }], []]
const followUpWeek = 3
const exception = () => h`<div class="mc-exc">${glyph('bang', { size: 16, className: 'gl mc-bang', stroke: 2.6, label: 'exception' })}<span><b>Mon 19</b> · Tomás Vega<br>overdue ${to()} done 6:45 am</span>${glyph('check', { size: 16, className: 'gl mc-ok', stroke: 2.6, label: 'done' })}</div>`
const marker = (week: (typeof weeks)[number]) => 'marker' in week ? h`<span class="mm mm-${week.marker.tone}">${week.marker.text}${'done' in week.marker ? glyph('check', { size: 15, className: 'gl', stroke: 2.4, label: 'done' }) : ''}</span>` : ''
const sites = () => h`<ul class="month-sites">${company.sites.map(site => h`<li>${glyph('pin', { size: 18, stroke: 1.8 })}<span>${site.name} · ${site.people}</span></li>`)}</ul>`

function grid(): Html {
  return h`<div class="month-grid" role="table" aria-label="Sierra Lakes Produce, Sep 29 to Nov 2, by week">
<div class="mg-row mg-head" role="row"><span class="mg-lab" role="columnheader"><span class="sr">Lane</span></span>${weeks.map(week => h`<div class="mg-cell" role="columnheader"><span class="mg-week">${week.label}</span>${marker(week)}</div>`)}</div>
<div class="mg-row mg-hire" role="row"><div class="mg-lab" role="rowheader"><span class="mg-kind">Hire</span><span class="mg-avatar">${rafael.initials}</span><span class="mg-name">${rafael.name}</span></div>${hire.map(list => h`<ul class="mg-cell" role="cell">${list.map(chip)}</ul>`)}</div>
<div class="mg-row mg-follow" role="row"><div class="mg-lab" role="rowheader"><span class="mg-kind">Follow-up</span><span class="mg-name">Tomás Vega<span class="mg-sub">Fresno night shift</span></span></div>${weeks.map((_, index) => index === followUpWeek ? h`<div class="mg-cell mg-span" role="cell" aria-colspan="2">${exception()}</div>` : index === followUpWeek + 1 ? '' : h`<div class="mg-cell" role="cell"></div>`)}</div>
<div class="mg-row mg-proc" role="row"><div class="mg-lab" role="rowheader"><span class="mg-kind">Procedure</span><span class="mg-tag">DP-7</span><span class="mg-name">Joliet dock doors</span></div>${procedure.map(list => h`<ul class="mg-cell" role="cell">${list.map(chip)}</ul>`)}</div>
</div>`
}

/** The phone plan: one block per week with that week's chips, hire first, the exception kept. */
function agenda(): Html {
  return h`<ol class="month-agenda">${weeks.map((week, index) => h`<li class="ma-week"><p class="ma-head"><span class="mg-week">${week.label}</span>${marker(week)}</p>${hire[index].length ? h`<p class="ma-lane">Hire · ${rafael.name}</p><ul class="ma-chips ma-hire">${hire[index].map(chip)}</ul>` : ''}${index === followUpWeek ? h`<p class="ma-lane">Follow-up · Tomás Vega</p>${exception()}` : ''}${procedure[index].length ? h`<p class="ma-lane">Procedure · DP-7 Joliet dock doors</p><ul class="ma-chips ma-proc">${procedure[index].map(chip)}</ul>` : ''}</li>`)}</ol>`
}

export function monthSection(): Html {
  const copy = sections.month
  const art = h`<div class="card month"><div class="month-top"><p class="month-title">${company.name} · Sep 29 – Nov 2</p>${sites()}</div>${grid()}${agenda()}</div>`
  return section({ id: 'month', tone: 'pale', eyebrow: copy.eyebrow, heading: copy.heading, body: copy.body, layout: 'stack', art })
}
