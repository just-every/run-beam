import { zip, syntheticImage } from './fixtures.mjs'
import { sourceDocx, sourceParagraph as paragraph } from './source-fixtures.mjs'

const wordCell = content => `<w:tc>${content}</w:tc>`
const wordGrid = (first, second, body) => `<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr>${wordCell(paragraph(first))}${wordCell(paragraph(second))}</w:tr><w:tr>${body}</w:tr></w:tbl>`

export function sourceNestedDocx() {
  const nested = wordGrid('Part', 'Condition', wordCell(paragraph('Tip') + '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Diagram" descr="Probe placement"/><a:graphic><a:graphicData><a:blip r:embed="rIdImage"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>') + wordCell(paragraph('Clean')))
  return sourceDocx('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Prepare</w:t></w:r></w:p>' + paragraph('Inspect the clean probe.') + wordGrid('Tool', 'Condition', wordCell(paragraph('Probe') + nested + paragraph('')) + wordCell(paragraph('Clean'))))
}

export function htmlNestedCompanionZip() {
  const nested = '<table><caption>Probe parts</caption><tr><th>Part</th><th>Condition</th></tr><tr><td>Tip<img src="./images/probe%20placement.png?revision=1#diagram" alt="Probe placement"></td><td>Clean</td></tr></table>'
  return zip([
    ['index.html', `<html><head><base href="https://untrusted.example.test/"><script>neverRead()</script></head><body><h1>Prepare</h1><p>Inspect the clean probe.</p><table><tr><th>Tool</th><th>Condition</th></tr><tr><td>Probe${nested}</td><td>Clean</td></tr></table><img src="https://untrusted.example.test/remote.png" alt="Remote diagram"><h2>Close</h2><p>Store tools.</p></body></html>`],
    ['images/probe placement.png', syntheticImage],
    ['unused.js', 'throw new Error("never execute source data")'],
  ])
}
