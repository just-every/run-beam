// 06 · Overdue, and the manager is out: Tomás Vega's overdue course, every delivery tried, the cover's approval of the
// agent's suggestion, and the recovery timeline that keeps the original due date.
import { h, type Html } from '../../../beam/ui/html'
import { glyph } from '../../icons'
import { sections } from '../copy'
import { disc, lines, pill, section } from '../parts'

const delivery = [
  { icon: 'mail', tint: 'violet', channel: 'Email', state: 'None on file' },
  { icon: 'chat', tint: 'green', channel: 'SMS · Wed Oct 14, 2:00 pm', state: 'Delivered · not opened' },
  { icon: 'chat', tint: 'blue', channel: 'SMS · Thu Oct 15, 2:00 pm', state: 'Delivered · not opened' },
  { icon: 'people', tint: 'yellow', channel: 'Teams · Ray Ortiz, manager', state: 'On leave Oct 19 – 30 (BambooHR)' },
  { icon: 'people', tint: 'violet', channel: 'Teams · Nadia Flores, cover', state: 'Read 6:14 am', read: true },
] as const

const timeline = [
  { time: 'Mon 6:04 am', event: 'Routed to Nadia Flores' },
  { time: 'Mon 6:30 am', event: 'SMS at shift end · opened 6:31' },
  { time: 'Mon 6:45 am', event: 'Completed', done: true },
  { time: 'Mon 6:45 am', event: 'Escalation stopped', done: true },
] as const

export function followUpSection(): Html {
  const copy = sections.followUp
  const art = h`<div class="fu-art">
<article class="card fu-card" aria-label="Tomás Vega, overdue"><header class="fu-head"><span class="fu-avatar">TV</span><div class="fu-who"><p class="fu-name">Tomás Vega<span class="fu-sep"> · </span><span class="fu-shift">night shift, Fresno</span></p><p class="fu-course">Ammonia release awareness · annual · due Fri Oct 16</p></div>${pill('Overdue 3 days', 'yellow')}</header>
<ul class="fu-rows">${delivery.map(row => h`<li>${disc(row.icon, row.tint)}<span class="fu-channel">${row.channel}</span><span class="fu-state${'read' in row ? ' fu-read' : ''}">${row.state}${'read' in row ? glyph('check', { size: 18, stroke: 2.4, label: 'read' }) : ''}</span></li>`)}</ul>
<div class="fu-agent"><p class="fu-agent-name"><span class="dot-y"></span>Agent</p><p class="fu-agent-text">Both reminders went out at 2:00 pm, mid-sleep for a night shift. Suggest 15 minutes at shift end, 6:30 am, on paid time.</p><p class="fu-approved">Approved by Nadia Flores · 6:20 am</p></div></article>
<article class="card fu-time" aria-label="Recovery timeline"><ol>${timeline.map(step => h`<li class="${'done' in step ? 'done' : ''}"><span class="fu-dot"></span><span class="fu-when">${step.time}</span><span class="fu-what">${step.event}${'done' in step && step.event === 'Completed' ? glyph('check', { size: 18, stroke: 2.4, label: 'done' }) : ''}</span></li>`)}</ol><p class="fu-kept">Original due date kept: Fri Oct 16</p></article>
</div>`
  return section({ id: 'follow-up', tone: 'pale', eyebrow: copy.eyebrow, heading: lines(...copy.heading), body: copy.body, layout: 'side', art })
}
