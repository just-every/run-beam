// 04 · 34°F, no signal. Lessons still play: Rafael's phone offline at 8:45 with seven attempts queued, the same phone
// synced at 9:12, and the strip that times the window.
import { h, type Html } from '../../../beam/ui/html'
import { glyph } from '../../icons'
import { sections } from '../copy'
import { disc, done, lines, section } from '../parts'
import { practical, sync } from '../records'

const lessons = [
  ['doc', 'violet', '1 Inspección antes del turno'],
  ['box', 'green', '2 Capacidad y carga'],
  ['snowflake', 'blue', '3 Puertas del cuarto frío'],
  ['crowd', 'yellow', '4 Peatones y bocinas'],
  ['warning', 'violet', '5 Rampas y pisos mojados'],
  ['power', 'blue', '6 Estacionar y apagar'],
] as const

const bar = (time: string, online: boolean) => h`<div class="ph-bar"><span>${time}</span><span class="ph-cam"></span><span class="ph-sig">${online ? h`<span class="ph-signal"><i></i><i></i><i></i><i></i></span>` : glyph('cloudOff', { size: 15, stroke: 2.2 })}<span class="ph-batt"></span></span></div>`
const nav = () => h`<div class="ph-nav" aria-hidden="true"><span class="ph-back"></span><span class="ph-home"></span><span class="ph-recent"></span></div>`

function offline(): Html {
  return h`<div class="phone" role="img" aria-label="Rafael's phone at 8:45, offline with ${sync.queued} attempts queued: Seguridad del montacargas, all ${sync.lessons} lessons done and the quiz passed 9 of 10, saved on the phone to sync on reconnect."><div class="ph-screen">${bar('8:45', false)}
<p class="ph-offline">${glyph('cloudOff', { size: 26, stroke: 1.7 })}Sin conexión · ${sync.queued} en cola</p><p class="ph-title">Seguridad del montacargas</p>
<ul class="ph-lessons">${lessons.map(([icon, tint, label]) => h`<li>${disc(icon, tint)}<span>${label}</span>${done()}</li>`)}<li class="ph-quiz">${disc('doc', 'green')}<span>Prueba · 9 de 10 · aprobado</span>${done()}</li></ul>
<p class="ph-note">Guardado en el teléfono · se sincroniza al reconectar</p>${nav()}</div></div>`
}

function online(): Html {
  return h`<div class="phone" role="img" aria-label="The same phone at ${sync.synced}: synced, ${sync.lessons} of ${sync.lessons} lessons, quiz ${sync.quiz}, 0 conflicts, and the practical with ${practical.assessor} on Tue Oct 20 at ${practical.booked}."><div class="ph-screen">${bar('9:12', true)}
<p class="ph-synced">${done()}Sincronizado ${sync.synced}</p>
<ul class="ph-rows"><li>${disc('doc', 'violet')}<span>${sync.lessons} de ${sync.lessons} lecciones</span>${done()}</li><li>${disc('doc', 'green')}<span>Prueba ${sync.quiz}</span>${done()}</li><li>${disc('sync', 'blue')}<span>0 conflictos</span>${done()}</li>
<li class="ph-next">${disc('calendar', 'marigold')}<span><b>Práctica con ${practical.assessor}</b><small>Mar 20 oct · ${practical.booked}</small></span></li></ul>${nav()}</div></div>`
}

const strip = () => h`<dl class="card sync-strip"><div><dt>Downloaded</dt><dd>${sync.downloaded} · break-room Wi-Fi</dd></div><div><dt>Offline</dt><dd>${sync.offline}</dd></div><div><dt>Synced</dt><dd>${sync.synced} · revision ${sync.revision} ${glyph('check', { size: 18, stroke: 2.4, label: 'done' })}</dd></div></dl>`

export function coolerSection(): Html {
  const copy = sections.cooler
  const art = h`<div class="cooler-art"><div class="phones">${offline()}<span class="phone-arrow" aria-hidden="true"><svg viewBox="0 0 64 20" width="64" height="20"><path d="M2 10h52" stroke="#fab60c" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 7"/><path d="m50 3 8 7-8 7" fill="none" stroke="#fab60c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>${online()}</div>${strip()}</div>`
  return section({ id: 'cooler', tone: 'pale', eyebrow: copy.eyebrow, heading: lines(...copy.heading), body: copy.body, layout: 'side-right', art })
}
