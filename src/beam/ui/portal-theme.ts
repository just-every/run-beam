import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { portalTheme } from '../portal-theme'
import { area, card, field, fileField, form, h } from './html'

export async function portalThemeCard(env: Bindings, actor: Actor) {
  if (!actor.owner) return ''
  const current = await portalTheme(env)
  return card('Employee portal theme', h`<p>Brand images are public on your sign-in page and in email. Upload PNG, JPEG or WebP images up to 256 KB. Colors must contrast with white text at 4.5:1 or better.</p>${form('theme.save', '/app/business', [
    field('Primary color', 'primary', { value: current?.primary ?? '#243e67' }),
    field('Accent color', 'accent', { value: current?.accent ?? '#325f8b' }),
    field('Sign-in heading', 'signinHeading', { value: current?.signinHeading ?? 'Sign in to your training' }),
    area('Sign-in text', 'signinText', current?.signinText ?? '', false),
    field('Email sender name', 'senderName', { value: current?.senderName ?? actor.business ?? 'Beam' }),
    fileField('Logo', 'logo', { accept: 'image/png,image/jpeg,image/webp' }),
    fileField('Favicon', 'favicon', { accept: 'image/png,image/jpeg,image/webp' }),
  ], 'Save theme', { multipart: true })}`)
}
