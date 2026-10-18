// Shared by the root renderer and the no-JavaScript first-run document.
// Beam's faces are the run site's (public/site/fonts.css); Inter, the body face, is preloaded.
export const fontLinks = [
  { rel: 'preload', href: '/fonts/inter/inter-latin-wght-normal.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'stylesheet', href: '/site/fonts.css' },
] as const

export const fontHead = fontLinks.map(link => `<link ${Object.entries(link).map(([name, value]) => `${name.toLowerCase()}="${value}"`).join(' ')}>`).join('')
