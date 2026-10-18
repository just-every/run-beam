// 03 · A badge number, a PIN, and Spanish: the shared break-room tablet in Spanish, with Rafael's first-sign-in sheet
// over its lower-left corner.
import { h, raw, type Html } from '../../../beam/ui/html'
import { glyph } from '../../icons'
import { sections } from '../copy'
import { disc, lines, section } from '../parts'
import { rafael } from '../records'

const courses = [
  { icon: 'forklift', tint: 'violet', title: 'Seguridad del montacargas', sub: '6 lecciones', due: 'Hoy', today: true },
  { icon: 'snowflake', tint: 'blue', title: 'Cuarto frío y EPP', sub: 'SCORM · 18 min', due: 'Vie 23 oct' },
  { icon: 'warning', tint: 'green', title: 'Amoníaco: respuesta a fugas', sub: 'Anual', due: 'Vie 30 oct' },
  { icon: 'people', tint: 'peach', title: 'Prevención del acoso (CA)', sub: '1 hora', due: '19 abr 2027' },
] as const

/** A sign-in QR drawn as modules: three finder squares and a fixed scatter, decoration only (it encodes nothing). */
function qr(): Html {
  const n = 21, cells: string[] = []
  const finder = (x: number, y: number) => cells.push(`M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5zM${x + 2} ${y + 2}h3v3h-3z`)
  finder(0, 0); finder(14, 0); finder(0, 14)
  let seed = 6082
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if ((x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12)) continue
    seed = (seed * 1103515245 + 12345) % 2147483648
    if (seed % 100 < 48) cells.push(`M${x} ${y}h1v1h-1z`)
  }
  return raw(`<svg class="qr" viewBox="-1 -1 23 23" aria-hidden="true"><path fill="#0d1228" fill-rule="evenodd" d="${cells.join('')}"/></svg>`)
}

function tablet(): Html {
  return h`<div class="tablet" role="img" aria-label="The shared break-room tablet in Spanish: Hola, Rafael, ID ${rafael.id}, Español. Tus cursos (4): Seguridad del montacargas, due today; Cuarto frío y EPP, Fri Oct 23; Amoníaco: respuesta a fugas, Fri Oct 30; Prevención del acoso (CA), Apr 19, 2027. The session closes after 5 minutes without use.">
<div class="tablet-screen"><div class="tb-top"><span class="tb-brand"><img src="/brand/mark.svg" alt="" width="22" height="26">Beam</span><span class="tb-pill">Tableta compartida · Sala de descanso</span></div>
<p class="tb-hello">Hola, Rafael</p><p class="tb-id">ID ${rafael.id} · Español</p><p class="tb-head">Tus cursos (4)</p>
<ul class="tb-list">${courses.map(course => h`<li>${disc(course.icon, course.tint)}<span class="tb-text"><b>${course.title}</b><span>${course.sub}</span></span><span class="tb-due${'today' in course ? ' today' : ''}">${course.due}</span></li>`)}</ul>
<p class="tb-foot">${glyph('clock', { size: 18 })}Se cierra la sesión tras 5 min sin uso</p></div></div>`
}

function sheet(): Html {
  return h`<div class="signin-sheet" role="img" aria-label="Rafael's first sign-in sheet: Rafael Medina, Fresno, CA; ID ${rafael.id}, username ${rafael.username}; a QR code; initial PIN hidden; expires Mon Oct 26; signed in Mon Oct 19 at 6:00 am.">
<p class="ss-title"><b>Beam</b> · first sign-in</p><p class="ss-line">${rafael.name} · ${rafael.city}</p><p class="ss-line ss-grey">ID ${rafael.id} · username ${rafael.username}</p>${qr()}
<p class="ss-pin">Initial PIN: <span class="ss-dots" role="img" aria-label="six digits, hidden"><i></i><i></i><i></i><i></i><i></i><i></i></span></p><p class="ss-grey ss-exp">Expires Mon Oct 26</p><p class="ss-ok">Signed in Mon Oct 19 · 6:00 am ${glyph('check', { size: 13, stroke: 2.4 })}</p></div>`
}

export function firstShiftSection(): Html {
  const copy = sections.firstShift
  return section({ id: 'first-shift', tone: 'white', eyebrow: copy.eyebrow, heading: lines(...copy.heading), body: copy.body, layout: 'side', art: h`<div class="fs-art">${tablet()}${sheet()}</div>` })
}
