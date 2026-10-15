// Riso drawings for empty states: a confident ink line, white-filled so it sits in front of a grained pink disc
// (the disc is .empty-art::before in public/beam.css). Decorative only.
const frame = (body: string) => `<span class="empty-art" aria-hidden="true"><svg viewBox="0 0 160 110" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg></span>`

// A ground line with a short hatched shadow to the right, shared by both drawings.
const ground = (from: number, to: number) => `<path d="M${from} 100H${to}"/><path stroke-width="1.4" d="M${to - 34} 103h30M${to - 26} 106h18"/>`

// Two stacked books: each has a rounded spine on the left, a cover face going back, and a page block on the right.
const book = (x: number, y: number, w: number) => {
  const d = 16, t = 18
  return `<path fill="#fff" d="M${x + 6} ${y}h${w}l${d} -${d * 0.62}h-${w}Z"/>`
    + `<path fill="#fff" d="M${x + w + 6} ${y}H${x + 6}a6 ${t / 2} 0 0 0 0 ${t}H${x + w + 6}Z"/>`
    + `<path fill="#fff" d="M${x + w + 6} ${y}l${d} -${d * 0.62}v${t}l-${d} ${d * 0.62}Z"/>`
    + `<path stroke-width="1.2" d="M${x + w + 6} ${y + 5}l${d} -${d * 0.62}M${x + w + 6} ${y + 9}l${d} -${d * 0.62}M${x + w + 6} ${y + 13}l${d} -${d * 0.62}"/>`
    + `<path stroke-width="1.6" d="M${x + 16} ${y}a6 ${t / 2} 0 0 0 0 ${t}"/>`
}

export const bookStack = frame(`${ground(14, 146)}${book(16, 82, 92)}${book(30, 60, 82)}`)
export const documentSheet = frame(`${ground(30, 136)}<path fill="#fff" d="M50 14h44l18 18v66H50Z"/><path d="M94 14v18h18M62 50h36M62 62h36M62 74h22"/>`)
