import type { Plugin } from 'vite'
import { buildDocs } from './build.ts'

// `virtual:beam-docs`: the docs sections and every page's rendered body, built from docs/ when the run site builds.
const id = 'virtual:beam-docs', resolved = `\0${id}`

export function docsSite(): Plugin {
  let root = process.cwd()
  return {
    name: 'beam:docs',
    configResolved(config) { root = config.root },
    resolveId(source) { return source === id ? resolved : undefined },
    load(source) {
      if (source !== resolved) return
      const site = buildDocs(root)
      for (const file of site.files) this.addWatchFile(file)
      return `export const sections = ${JSON.stringify(site.sections)};\nexport const bodies = ${JSON.stringify(site.bodies)};\n`
    },
  }
}
