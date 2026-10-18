// The run site's line glyphs, drawn on a 24 grid in the desk's card style (round caps, 1.8 stroke). Inline SVG, so the
// site needs no icon font and no arrow or check glyph from the text faces.
import { esc, raw, type Html } from '../beam/ui/html'

const PATHS = {
  tablet: '<rect x="6" y="3" width="12" height="18" rx="2.2"/><path d="M11 17.5h2"/>',
  people: '<circle cx="9" cy="8.5" r="3"/><circle cx="16.5" cy="9.5" r="2.4"/><path d="M3.5 19c.6-3.3 2.8-5.2 5.5-5.2s4.9 1.9 5.5 5.2M15 14.2c2.6-.5 5 1 5.5 4.3"/>',
  person: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-4 3.6-6 7-6s6.2 2 7 6"/>',
  doc: '<rect x="5.5" y="3" width="13" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  file: '<path d="M7 3h7l4.5 4.5V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v4.5h4.5"/>',
  fileBadge: '<path d="M13.5 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l4.5 4.5V11"/><path d="M14 3v4.5h4.5M8.5 10h5M8.5 13.5h3"/><circle cx="16.5" cy="15.5" r="2.5"/><path d="m15.2 17.6-.7 3.4 2-1 2 1-.7-3.4"/>',
  fileCheck: '<path d="M12.5 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l4.5 4.5V12"/><path d="M14 3v4.5h4.5M8.5 10h5M8.5 13.5h3"/><circle cx="17" cy="17" r="4" fill="currentColor" stroke="none"/><path d="m15.3 17 1.2 1.2 2.2-2.3" stroke="#fff" stroke-width="1.5"/>',
  forklift: '<path d="M3.5 17V9.5h5l2.5 4.5v3"/><path d="M5.5 9.5V5.5h2.5l1.2 4"/><path d="M14.5 4v13.5h6"/><path d="M11 14h3.5"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="11.5" cy="17.5" r="1.8"/>',
  snowflake: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="m9.5 4.5 2.5 2 2.5-2M9.5 19.5l2.5-2 2.5 2M4.5 10.6l3.1-.5-1-3M19.5 13.4l-3.1.5 1 3M4.5 13.4l3.1.5-1 3M19.5 10.6l-3.1-.5 1-3"/>',
  warning: '<path d="M10.3 4.2 2.8 17.4A2 2 0 0 0 4.5 20.4h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4.5M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  cloudOff: '<path d="m3 3 18 18"/><path d="M8.5 6.3A6 6 0 0 1 17.6 10h.4a4 4 0 0 1 2.4 7.2M17 19H7a4.5 4.5 0 0 1-1.4-8.8"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  crowd: '<circle cx="12" cy="7.5" r="2.6"/><circle cx="5.5" cy="9.5" r="2.1"/><circle cx="18.5" cy="9.5" r="2.1"/><path d="M7.5 19c.4-3.2 2.2-5 4.5-5s4.1 1.8 4.5 5M2.5 18c.3-2.2 1.5-3.6 3.2-3.8M21.5 18c-.3-2.2-1.5-3.6-3.2-3.8"/>',
  power: '<path d="M12 3.5v8"/><path d="M7 6.5a7.5 7.5 0 1 0 10 0"/>',
  sync: '<path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1"/><path d="M17.5 3v4h-4M6.5 21v-4h4"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  calendarGrid: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M8.5 3.5v4M15.5 3.5v4"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01" stroke-width="2.4"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  chat: '<path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5Z"/>',
  peopleCheck: '<circle cx="9" cy="7.5" r="2.6"/><circle cx="15.5" cy="7" r="2.1"/><circle cx="4.5" cy="10" r="1.8"/><path d="M3 18c.4-3.5 2.8-5.5 6-5.5 1.5 0 2.8.4 3.8 1.2M2 15.5c.3-1.5 1-2.4 2.2-2.8"/><circle cx="17" cy="16" r="3.8"/><path d="m15.4 16 1.1 1.1 2-2.1"/>',
  question: '<path d="M9 9a3 3 0 1 1 4.1 2.8c-.7.3-1.1.9-1.1 1.6v.8M12 17.5h.01"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  arrow: '<path d="M4.5 12h14M13 6l6 6-6 6"/>',
  arrowLong: '<path d="M2 12h19M16.5 7.5 21 12l-4.5 4.5"/>',
  cross: '<path d="m7 7 10 10M17 7 7 17"/>',
  minus: '<path d="M7 12h10"/>',
  bang: '<path d="M12 6.5v7M12 17.5h.01"/>',
} as const

export type Glyph = keyof typeof PATHS

/** One glyph as inline SVG; `label` makes it an image with a name, otherwise it is decoration. */
export function glyph(name: Glyph, { size = 24, className = 'gl', label = '', stroke = 1.8 } = {}): Html {
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'
  return raw(`<svg class="${className}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${PATHS[name]}</svg>`)
}

