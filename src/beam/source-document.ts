// Format dispatch for bounded, inert source preparation. Originals stay authority.
import { insist } from './core'
import { SourceContent } from './source-content'
import { utf8 } from './source-archive'
import { extractDocx, extractPptx } from './source-office'
import { extractHtml } from './source-html'
import { extractPdf } from './source-pdf'
export type { ExtractedLesson, SourceDocument, SourceAsset, SourceBlock, SourceCell, SourceUncertainty } from './source-content'

export async function extractDocument(bytes: Uint8Array, filename: string, title: string) {
  const content = new SourceContent(title)
  const extension = filename.split('.').at(-1)?.toLowerCase() ?? ''
  if (extension === 'docx') extractDocx(bytes, content)
  else if (extension === 'pptx') extractPptx(bytes, content)
  else if (extension === 'html' || extension === 'htm') extractHtml(bytes, content)
  else if (extension === 'pdf') await extractPdf(bytes, content)
  else {
    insist(['txt', 'md', 'markdown'].includes(extension), 'source_extraction_unsupported', 422, { supported: ['txt', 'md', 'markdown', 'docx', 'pptx', 'html', 'pdf'] })
    insist(bytes.length <= 1_000_000, 'document_text_size', 422)
    const value = utf8(bytes)
    insist(!/[\x00-\x08\x0e-\x1f]/.test(value), 'document_not_text', 422)
    content.warnings.add('Text extraction recognizes Markdown-style headings. Other markup stays literal text; compare its structure with the original.')
    let paragraph: string[] = [], start = 1
    const flush = () => { content.text(paragraph.join('\n'), `Lines ${start}–${start + paragraph.length - 1}`); paragraph = [] }
    for (const [index, line] of value.replace(/\r\n?/g, '\n').split('\n').entries()) {
      const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/)
      if (heading) { flush(); content.heading(heading[1], `Line ${index + 1}`); start = index + 2 }
      else { if (!paragraph.length) start = index + 1; paragraph.push(line) }
    }
    flush()
  }
  return content.finish(extension)
}
