// Beam's line icons: one ink stroke on a 24px grid, drawn inline so pages need no image request. The app's card discs
// and the run site's drawings share them.
const PATHS = {
  book: '<path d="M12 6.5C10 5 7 4.6 3.5 5v13c3.5-.4 6.5 0 8.5 1.5 2-1.5 5-1.9 8.5-1.5V5C17 4.6 14 5 12 6.5Z"/><path d="M12 6.5v13"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  check: '<path d="m5.5 12.5 4 4 9-9"/>',
  document: '<path d="M6.5 3.5h7l4 4v13h-11Z"/><path d="M13.5 3.5v4h4M9 12h6M9 15.5h6"/>',
  clipboard: '<rect x="5.5" y="5" width="13" height="16" rx="1.5"/><path d="M9 5V3.5h6V5M9 11h6M9 14.5h6M9 18h4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  refresh: '<path d="M19 12a7 7 0 0 1-12.2 4.7M5 12a7 7 0 0 1 12.2-4.7"/><path d="M17.5 3.5v4h-4M6.5 20.5v-4h4"/>',
  people: '<circle cx="9" cy="8.5" r="3"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M3.5 19c.5-3.2 2.7-5 5.5-5s5 1.8 5.5 5M14.5 14.3c.6-.2 1.3-.3 2-.3 2.4 0 4 1.5 4.5 4"/>',
  person: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-4 3.6-6 7-6s6.2 2 7 6"/>',
  play: '<path d="M8 5.5v13l10-6.5Z"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="1.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 16.5h.01M12 16.5h.01"/>',
  rosette: '<circle cx="12" cy="9" r="5"/><circle cx="12" cy="9" r="2"/><path d="m9 13.3-2 7.2 3-1.5 2 2 .5-6.5M15 13.3l2 7.2-3-1.5-2 2"/>',
  paths: '<rect x="9" y="3.5" width="6" height="4.5" rx="1"/><rect x="3" y="16" width="6" height="4.5" rx="1"/><rect x="15" y="16" width="6" height="4.5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
  laptop: '<rect x="5" y="5.5" width="14" height="9.5" rx="1"/><path d="M3 18.5h18"/>',
  cloud: '<path d="M7 18.5a4 4 0 0 1-.6-8 5.5 5.5 0 0 1 10.7-1.2A4.5 4.5 0 0 1 17 18.5Z"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.5v.7M12 16.8h.01"/>',
  sparkle: '<path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  back: '<path d="M19 12H5.5M11 6l-6 6 6 6"/>',
  arrow: '<path d="M4.5 12h14M13 6l6 6-6 6"/>',
  arrowDown: '<path d="M12 4.5v14M6 13l6 6 6-6"/>',
} as const

export type IconName = keyof typeof PATHS

/** An inline icon; decorative unless a label is given. */
export function icon(name: IconName, { size = 24, label = '', className = 'icon' } = {}): string {
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true" focusable="false"'
  return `<svg class="${className}" ${a11y} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`
}
