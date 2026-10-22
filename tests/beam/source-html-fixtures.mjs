import { zip, syntheticImage } from './fixtures.mjs'

const procedure = source => `<html><head><base href="https://untrusted.example.test/"><script>neverRead()</script></head><body><h1>Prepare</h1><p>Inspect the clean probe.</p><table><tr><th>Tool</th><th>Condition</th></tr><tr><td>Probe</td><td>Clean</td></tr></table><img src="${source}" alt="Probe placement"><img src="https://untrusted.example.test/remote.png" alt="Remote diagram"><h2>Close</h2><p>Store tools.</p></body></html>`

export function htmlCompanionZip({ nested = false } = {}) {
  return zip([
    [nested ? 'procedure/steps.html' : 'index.html', procedure(nested ? '../images/probe%20placement.png' : './images/probe%20placement.png?revision=1#diagram')],
    ['images/probe placement.png', syntheticImage],
    ['unused.js', 'throw new Error("never execute source data")'],
  ])
}

export const htmlAmbiguousZip = () => zip([
  ['first.html', procedure('images/probe.png')],
  ['second.html', '<h1>Do not choose this arbitrarily</h1>'],
  ['images/probe.png', syntheticImage],
])

export function htmlTraversalZip(mode = 'reference') {
  if (!['reference', 'encoded', 'entry'].includes(mode)) throw new Error('Unknown traversal fixture')
  return zip([
    ['index.html', procedure(mode === 'encoded' ? '%2e%2e/images/probe.png' : '../images/probe.png')],
    [mode === 'entry' ? '../images/probe.png' : 'images/probe.png', syntheticImage],
  ])
}

export const htmlOversizeZip = () => zip([['index.html', '<p>' + 'x'.repeat(1_000_001) + '</p>']])

export function htmlCorruptZip() {
  const bytes = htmlCompanionZip()
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  bytes[central + 16] ^= 1
  return bytes
}
