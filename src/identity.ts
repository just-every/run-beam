// Beam's identity: what its installed Lobby says. The name and colour are the
// ones setup saves in src/branding.json.
import type { EditionIdentity } from './base/identity'
import branding from './branding.json'

export const identity: EditionIdentity = {
  product: 'Beam', deployment: branding.name,
  purpose: '{deployment} teaches your own procedures: reviewed course revisions, assignments, quizzes, assessor sign-off and the record of who completed which revision.',
  tagline: 'Free, open source training for your own procedures: reviewed courses, assignments, quizzes and revision-bound completion records. MIT licensed.',
  signInPath: '/signin', runSite: 'https://run-beam.com', installedHome: 'lobby',
  theme: '/rer-theme.css', mark: '/brand/mark.svg', band: '/brand/band.svg', fonts: '/fonts/fonts.css', accentColor: branding.primaryColor,
}
