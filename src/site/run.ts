import type { RunData } from '../base/run-site'

/** Every string and command the run site's Run page (run-beam.com/run) shows. */
export const run: RunData = {
  name: 'Beam',
  repository: 'https://github.com/just-every/run-beam',
  clone: 'npx -y @runeditrun/rer dev just-every/run-beam',
  folder: 'run-beam',
  requirements: 'Runs on macOS, Linux or Windows with WSL2, with git. The installer brings Node when it is missing, and rer brings pnpm.',
  licence: 'MIT',
  docs: true,
  hosted: [],
}
