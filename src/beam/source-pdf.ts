// PDF.js serverless parser. No URL input, JavaScript evaluation, fonts or CMaps
// fetched from documents. Image-only pages remain explicitly unconverted OCR work.
import { getDocumentProxy, getResolvedPDFJS, extractImages } from 'unpdf'
import { BeamError, insist } from './core'
import { SourceContent } from './source-content'
import { pdfRasterPng } from './source-png'
import { taggedPdfContent } from './source-pdf-structure'

export async function extractPdf(bytes: Uint8Array, content: SourceContent) {
  insist(bytes.length <= 10_000_000, 'document_pdf_size', 422)
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined
  let destroy: (() => Promise<void>) | undefined, timer: ReturnType<typeof setTimeout> | undefined, timedOut = false
  try {
    const { getDocument } = await getResolvedPDFJS()
    const task = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: false, useWorkerFetch: false,
      disableFontFace: true, stopAtErrors: true, maxImageSize: 4_000_000,
      cMapUrl: undefined, standardFontDataUrl: undefined, wasmUrl: undefined,
    })
    destroy = () => task.destroy()
    timer = setTimeout(() => { timedOut = true; void task.destroy().catch(() => {}) }, 15_000)
    pdf = await task.promise
    insist(pdf.numPages > 0 && pdf.numPages <= 60, 'document_page_limit', 422)
    content.warnings.add('PDF text retains page references. Tagged headings and simple table cells are preserved when their complete reading order is available. Check merged cells, visual layout, untagged table structure and image descriptions against the original; these cannot be inferred reliably. Scanned pages require actual OCR before conversion.')
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number), location = `Page ${number}`
      content.heading(`Page ${number}`, location)
      const text = await page.getTextContent({ includeMarkedContent: true })
      insist(text.items.length <= 20_000, 'document_pdf_text_limit', 422)
      let value = ''
      for (const item of text.items) if ('str' in item) {
        value += item.str + (item.hasEOL ? '\n' : ' ')
        insist(value.length <= 50_000, 'document_lesson_limit', 422)
      }
      const structured = taggedPdfContent(await page.getStructTree(), text.items)
      if (structured) for (const part of structured) {
        if (part.kind === 'heading') content.heading(part.text, location)
        else if (part.kind === 'table') content.table(part.table, location, `${location} table`)
        else content.text(part.text, location)
      }
      else content.text(value.replace(/[ \t]+\n/g, '\n').trim(), location)
      const images = await extractImages(pdf, number)
      insist(images.length <= 30, 'document_image_limit', 422)
      for (const [index, image] of images.entries()) content.image(pdfRasterPng(image.width, image.height, image.channels, image.data), `page-${number}-image-${index + 1}.png`, '', `${location}, image ${index + 1}`)
      if (!value.trim()) {
        content.uncertain(location, '', 'This page has no extractable text. An authorized OCR provider must read the original before its passages can become draft lessons.', true)
        // Retain a visible page even if its image is encoded in an unsupported PDF operator.
        if (!images.length) content.text('[No extractable page text. Open the original page; OCR is required.]', location)
      } else content.uncertain(location, value.trim(), 'PDF reading order and text recognition must be compared with this original page.', false)
      page.cleanup()
    }
  } catch (error) {
    if (timedOut) throw new BeamError('document_pdf_timeout', 422)
    if (error instanceof BeamError) throw error
    // Parser/network internals can include untrusted document content.
    throw new BeamError('document_invalid_pdf', 422)
  } finally { if (timer) clearTimeout(timer); await destroy?.() }
}
