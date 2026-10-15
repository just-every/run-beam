import type { RunData } from '../base/run-site'

/** Every string and command the run site's Run page (run-beam.com/run) shows. */
export const run: RunData = {
  name: 'Beam',
  repository: 'https://github.com/just-every/run-beam',
  clone: 'git clone https://github.com/just-every/run-beam.git beam',
  folder: 'beam',
  requirements: 'Needs Node 22 or later and pnpm 10.12.4, on macOS, Linux or Windows with WSL2.',
  licence: 'MIT',
  docs: true,
  hosted: [],
}
