import type { RunData } from '../base/run-site'
import { runPricing } from '../base/run-pricing'

/** Every string and command the run site's Run page (run-beam.com/run) shows. */
export const run: RunData = {
  name: 'Beam',
  repository: 'https://github.com/just-every/run-beam',
  clone: 'npx -y @runeditrun/rer dev just-every/run-beam',
  licence: 'MIT',
  docs: true,
  paths: { product: null },
  pricing: runPricing,
}
