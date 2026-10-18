// Small pieces every homepage section shares: the dated section frame, the painted bands and the card atoms the
// product drawings are made of. Everything is HTML and CSS; only the three painted bands are images.
import { esc, h, raw, type Html } from '../../beam/ui/html'
import { glyph, type Glyph } from '../icons'

export type Tone = 'white' | 'pale' | 'navy'

/** A dated section: eyebrow, heading and body beside or above its drawing. */
export function section({ id, tone, eyebrow, heading, body, layout, art, extra }: { id: string; tone: Tone; eyebrow: string; heading: Html | string; body: string; layout: 'stack' | 'side' | 'side-right'; art: Html; extra?: Html }): Html {
  return h`<section class="sec tone-${tone} sec-${layout}" id="${id}" aria-labelledby="${id}-h"><div class="wrap sec-grid"><div class="sec-copy"><p class="eyebrow">${eyebrow}</p><h2 id="${id}-h">${heading}</h2><p class="sec-body">${body}</p>${extra ?? ''}</div><div class="sec-art">${art}</div></div></section>`
}

/** A heading with chosen line breaks at wide widths; a plain space when the column is narrow. */
export const lines = (...parts: string[]) => raw(parts.map(part => h`<span class="ln">${part}</span>`.html).join(' '))

const sources = (name: string, widths: number[]) => (type: string) => widths.map(width => `/site/${name}-${width}.${type} ${width}w`).join(', ')

/** One painted band at responsive sizes (AVIF, then WebP), with an optional narrow crop (below 761px unless `below` says). */
export function painting({ name, widths, sizes, alt, width, height, eager = false, phone, className = '' }: { name: string; widths: number[]; sizes: string; alt: string; width: number; height: number; eager?: boolean; phone?: { name: string; widths: number[]; width: number; height: number; below?: number }; className?: string }): Html {
  const main = sources(name, widths), small = phone && sources(phone.name, phone.widths)
  const media = `(max-width: ${phone?.below ?? 760}px)`
  const load = eager ? raw(' fetchpriority="high"') : raw(' loading="lazy"')
  return h`<picture class="${className}">${small ? h`<source media="${media}" type="image/avif" srcset="${small('avif')}" sizes="100vw" width="${phone!.width}" height="${phone!.height}"><source media="${media}" type="image/webp" srcset="${small('webp')}" sizes="100vw" width="${phone!.width}" height="${phone!.height}">` : ''}<source type="image/avif" srcset="${main('avif')}" sizes="${sizes}"><img src="/site/${name}-${widths[widths.length - 1]}.webp" srcset="${main('webp')}" sizes="${sizes}" width="${width}" height="${height}" alt="${alt}" decoding="async"${load}></picture>`
}

export type Tint = 'violet' | 'green' | 'blue' | 'yellow' | 'peach' | 'marigold' | 'navy'
/** A tinted round icon holder. */
export const disc = (name: Glyph, tint: Tint, className = '') => h`<span class="disc t-${tint}${className ? ` ${className}` : ''}">${glyph(name)}</span>`
/** A filled green circle with a white check: an item that is done. */
export const done = (label = 'done') => h`<span class="okc" role="img" aria-label="${label}">${glyph('check', { size: 14, className: 'gl', stroke: 2.8 })}</span>`
/** The long thin arrow drawn between two states in a line. */
export const to = () => h`<span class="to">${glyph('arrowLong', { size: 16, className: 'gl', stroke: 1.6 })}</span>`
export const pill = (text: Html | string, kind: 'yellow' | 'green' | 'grey' | 'blue' | 'navy' = 'grey') => h`<span class="pill p-${kind}">${text}</span>`
/** Text whose " → " steps are drawn as the long arrow (the text faces carry no arrow glyph). */
export const steps = (text: string) => raw(text.split(' → ').map(esc).join(`\u00a0${to().html} `))
