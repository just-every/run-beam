// Companion resources come only from this immutable ZIP, never a URL or disk.
import { insist } from './core'
import { officeArchive } from './source-archive'
import { extractHtml, type HtmlImageResolver } from './source-html'
import type { SourceContent } from './source-content'

export function extractHtmlArchive(bytes: Uint8Array, content: SourceContent) {
  insist(bytes.length <= 25_000_000, 'document_html_archive_size', 422)
  const archive = officeArchive(bytes)
  const documents = archive.names.filter(name => /\.html?$/i.test(name))
  const roots = documents.filter(name => /^index\.html?$/i.test(name))
  const entry = roots.length === 1 ? roots[0] : roots.length === 0 && documents.length === 1 ? documents[0] : undefined
  insist(entry, 'document_html_entrypoint', 422)
  // Check every file's CRC and local header, including unused companions, so a
  // corrupt package cannot appear to have been successfully extracted.
  for (const name of archive.names) {
    insist(name && !/[\\:\u0000-\u001f\u007f]/.test(name) && !name.includes('//'), 'document_invalid_zip', 422)
    if (!name.endsWith('/')) archive.read(name, /\.html?$/i.test(name) ? 1_000_000 : 8_000_000)
  }
  const directory = entry.split('/').slice(0, -1)
  const resolve: HtmlImageResolver = source => {
    const reference = source.trim()
    if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/|#|\?)/i.test(reference)) return
    let path: string
    try { path = decodeURIComponent(reference.split(/[?#]/, 1)[0]) }
    catch { insist(false, 'document_html_image_path', 422) }
    insist(!path.startsWith('/') && !/[\\:\u0000-\u001f\u007f]/.test(path), 'document_html_image_path', 422)
    const components = [...directory]
    for (const component of path.split('/')) {
      if (component === '..') insist(components.pop() !== undefined, 'document_html_image_path', 422)
      else if (component && component !== '.') components.push(component)
    }
    const name = components.join('/')
    if (!/\.(?:png|jpe?g|gif|webp)$/i.test(name) || !archive.has(name)) return
    return { bytes: archive.read(name, 8_000_000), filename: components.at(-1)! }
  }
  content.warnings.add('Relative HTML images use only files in this original ZIP. Base URLs, stylesheets, scripts and remote resources are not loaded; compare the extracted document with the packaged original.')
  extractHtml(archive.read(entry, 1_000_000), content, resolve)
}
