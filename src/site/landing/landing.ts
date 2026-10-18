// The run site's homepage, in the owner-approved order (desk page-s1, 18 Oct 2026): one month at Sierra Lakes Produce
// from the hero to the closing, each dated section drawing Beam's own screens in HTML.
import { h, type Html } from '../../beam/ui/html'
import { siteFooter } from '../shell'
import { heroSection } from './hero'
import { closingSection } from './sections/closing'
import { complianceSection } from './sections/compliance'
import { coolerSection } from './sections/cooler'
import { diagnosisSection } from './sections/diagnosis'
import { firstShiftSection } from './sections/first-shift'
import { followUpSection } from './sections/follow-up'
import { interludeSection } from './sections/interlude'
import { monthSection } from './sections/month'
import { moveInSection } from './sections/move-in'
import { practicalSection } from './sections/practical'
import { redraftSection } from './sections/redraft'

export function landing(): Html {
  return h`<main class="landing">
${heroSection()}
${monthSection()}
${firstShiftSection()}
${coolerSection()}
${practicalSection()}
${followUpSection()}
${diagnosisSection()}
${redraftSection()}
${interludeSection()}
${complianceSection()}
${moveInSection()}
${closingSection()}
</main>
${siteFooter()}`
}
