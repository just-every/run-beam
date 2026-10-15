// The landing page's risograph drawings: real Beam labels on ink-outlined sheets over the off-register pink plate, the
// one phrase that matters under the highlighter. Every visible string comes from Beam's own screens and fixtures.
import { h, raw, type Html } from '../../beam/ui/html'
import { icon, type IconName } from '../../beam/ui/icons'

const lines = (...widths: number[]) => raw(widths.map(width => `<span class="ph" style="width:${width}%"></span>`).join(''))
const glyph = (name: IconName) => raw(icon(name, { size: 22 }))
/** A tilted sheet: the wrapper tilts, so the card's plate stays behind its own card. */
const sheet = (tilt: string, body: Html, className = '') => h`<div class="tilt ${tilt}"><div class="card sheet${className ? ` ${className}` : ''}">${body}</div></div>`
const drawing = (label: string, body: Html, className = '') => h`<div class="art${className ? ` ${className}` : ''}" role="img" aria-label="${label}">${body}</div>`

const arrow = (down = false) => raw(`<span class="flow-arrow${down ? ' down' : ''}" aria-hidden="true">${icon('arrow', { size: 44, className: 'icon' })}</span>`)
const step = (n: number, body: Html) => h`<div class="step"><span class="num" aria-hidden="true">${n}</span>${body}</div>`

export function heroDrawing(label: string): Html {
  return h`<div class="hero-art" role="img" aria-label="${label}">
${step(1, sheet('l2', h`<p class="sheet-title">Front desk handbook</p><p class="sheet-meta">Version 3</p>${lines(88, 70)}<p class="sheet-hl"><mark class="hl">Disarm the alarm, then check the fridge log.</mark></p>${lines(84, 64)}`))}
${arrow()}
${step(2, sheet('r1', h`<p class="sheet-title">Opening the clinic</p><p class="sheet-tag"><mark class="hl">Revision 3</mark></p><p class="sheet-item">${glyph('book')}<span>Front desk</span></p><p class="sheet-item">${glyph('calendar')}<span>Due 29 Oct</span></p>${lines(92, 80, 60)}`))}
${arrow()}
${step(3, sheet('l1', h`<p class="sheet-person"><span class="avatar">${glyph('person')}</span><span class="sheet-title">Sam Lee</span></p><p class="sheet-item">${raw('<span class="tick">' + icon('check', { size: 18 }) + '</span>')}<mark class="hl">Completed</mark></p><p class="sheet-item">${glyph('document')}<span>Revision 3</span></p><p class="sheet-item">${glyph('rosette')}<span>Certificate</span></p>`))}
</div>`
}

export const freeDrawing = () => drawing('An MIT License card: free of charge.', sheet('r2', h`<p class="sheet-title">MIT License</p>${lines(92, 76)}<p class="sheet-row">${lines(30)}<mark class="hl">free of charge</mark>${lines(24)}</p>${lines(88, 58)}<span class="ph ink"></span>`))

export const changesDrawing = () => drawing('Source changed: “Front desk handbook” moved from version 2 to 3. Move open assignments to this revision. Publish this revision.', sheet('l1', h`<p class="sheet-title">Source changed</p><p class="sheet-text">“Front desk handbook” moved from version 2 to 3.</p><p class="sheet-choice"><span class="radio on"></span><span><mark class="hl">Move open assignments to this revision</mark></span></p><p class="sheet-choice"><span class="radio"></span>${lines(70)}</p><span class="pill-button">Publish this revision</span>`))

export const quizDrawing = () => drawing('Quiz, pass mark 80%: What do you check after disarming the alarm? The fridge log, ticked. Passed. Assessor: Tom Okafor.', sheet('r1', h`<p class="sheet-head"><span><span class="sheet-title">Quiz</span><span class="sheet-meta">Pass mark 80%</span></span><span class="tag-hl">Passed</span></p><p class="sheet-text">What do you check after disarming the alarm?</p><p class="sheet-choice"><span class="box on">${raw(icon('check', { size: 14 }))}</span><span><mark class="hl">The fridge log</mark></span></p><p class="sheet-choice"><span class="radio"></span>The mail</p><p class="sheet-choice"><span class="radio"></span>The weather</p><p class="sheet-foot">Assessor: Tom Okafor</p>`))

export const recordsDrawing = () => drawing('Training report: Sam Lee and Ana Ruiz completed Opening the clinic, revision 3. Download CSV.', sheet('l1', h`<p class="sheet-title">Training report</p>${['Sam Lee', 'Ana Ruiz'].map(name => h`<p class="sheet-report"><span>${name}</span><span>Opening the clinic — revision 3</span><mark class="hl">Completed</mark></p>`)}<p class="sheet-link">Download CSV</p>`), 'wide')

export const agentDrawing = () => drawing('A course draft, Closing the clinic, prepared by Tom Okafor’s agent, waiting for Approve.', sheet('r2', h`<p><span class="tag-hl">Course draft</span></p><p class="sheet-title big">Closing the clinic</p><p class="sheet-meta">Prepared by Tom Okafor's agent</p>${lines(90, 72)}<p class="sheet-end"><span class="pill-button small">Approve</span></p>`))

export const moveInDrawing = () => drawing('Import preview. This is a dry run: nothing has been written. TalentLMS history.', sheet('r1', h`<p class="sheet-title">Import preview</p><p class="sheet-meta">This is a dry run: nothing has been written.</p>${lines(86, 66)}<p><mark class="hl tag-mark">TalentLMS history</mark></p>`))

/** The closing band's two quiet side sheets, decoration only. */
export const bandSheets = () => raw(`<div class="band-sheets" aria-hidden="true"><div class="tilt l2 band-left"><div class="card sheet">${'<span class="ph" style="width:80%"></span><span class="ph" style="width:60%"></span><span class="ph hlbar" style="width:90%"></span><span class="ph" style="width:70%"></span>'}</div></div><div class="tilt r2 band-right"><div class="card sheet"><span class="dot"></span><span class="ph" style="width:70%"></span><span class="ph hlbar" style="width:85%"></span><span class="ph" style="width:60%"></span></div></div></div>`)
